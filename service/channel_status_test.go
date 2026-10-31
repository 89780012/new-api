package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestChannelStatusProjectionAndCache(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		assert.Equal(t, "test-admin-secret", r.Header.Get("x-api-key"))
		assert.Empty(t, r.Header.Get("Cookie"))
		assert.Equal(t, http.MethodGet, r.Method)
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/history") {
			assert.Equal(t, "model/a+b", r.URL.Query().Get("model"))
			assert.Equal(t, "60", r.URL.Query().Get("limit"))
			_, _ = w.Write([]byte(`{"code":0,"data":{"items":[{"status":"operational","latency_ms":0,"ping_latency_ms":0,"checked_at":"2026-10-31T02:00:00Z","message":"secret-upstream-message"},{"status":"error","latency_ms":null,"ping_latency_ms":null,"checked_at":"2026-10-31T01:00:00Z"}]}}`))
			return
		}
		if r.URL.Query().Get("page") == "2" {
			_, _ = w.Write([]byte(`{"code":0,"data":{"items":[{"id":3,"enabled":true,"name":"second page","primary_model":"","primary_status":"unknown"}],"total":101}}`))
			return
		}
		assert.Equal(t, "true", r.URL.Query().Get("enabled"))
		_, _ = w.Write([]byte(`{"code":0,"data":{"items":[{"id":1,"enabled":true,"name":"visible","provider":"openai","primary_model":"model/a+b","primary_status":"operational","primary_latency_ms":0,"availability_7d":99.5,"endpoint":"secret-endpoint","extra_headers":{"Authorization":"secret-header"},"api_key_masked":"secret-prefix"},{"id":2,"enabled":true,"name":"excluded"},{"id":4,"enabled":false,"name":"disabled"}],"total":101}}`))
	}))
	defer server.Close()
	t.Setenv("SUB2API_BASE_URL", server.URL+"/")
	t.Setenv("SUB2API_ADMIN_KEY", "test-admin-secret")
	t.Setenv("SUB2API_MONITOR_IDS", "1,3,4")
	var source channelStatusSource
	snapshot, err := source.get(context.Background())
	require.NoError(t, err)
	require.Len(t, snapshot.Items, 2)
	assert.True(t, snapshot.Enabled)
	assert.NotEmpty(t, snapshot.UpdatedAt)
	assert.Equal(t, "second page", snapshot.Items[1].Name)
	assert.Empty(t, snapshot.Items[1].Timeline)
	item := snapshot.Items[0]
	assert.Equal(t, 99.5, item.Availability7d)
	require.NotNil(t, item.PrimaryLatencyMS)
	assert.Zero(t, *item.PrimaryLatencyMS)
	require.NotNil(t, item.PrimaryPingLatencyMS)
	assert.Zero(t, *item.PrimaryPingLatencyMS)
	require.Len(t, item.Timeline, 2)
	assert.Equal(t, "error", item.Timeline[0].Status)
	assert.Equal(t, "operational", item.Timeline[1].Status)
	body, err := common.Marshal(snapshot)
	require.NoError(t, err)
	assert.NotContains(t, string(body), "secret")
	assert.NotContains(t, string(body), "excluded")
	assert.NotContains(t, string(body), "disabled")
	_, err = source.get(context.Background())
	require.NoError(t, err)
	assert.EqualValues(t, 3, calls.Load(), "cached snapshot avoids all upstream calls")
	source.expires = time.Time{}
	_, err = source.get(context.Background())
	require.NoError(t, err)
	assert.EqualValues(t, 6, calls.Load(), "expired snapshot refreshes")
}

func TestChannelStatusFailureAndConfiguration(t *testing.T) {
	for _, tc := range []struct {
		name, response string
		status         int
	}{
		{"unauthorized", `{"message":"secret"}`, 401},
		{"expired key", `{"code":401,"message":"secret"}`, 200},
		{"invalid JSON", `not json secret`, 200},
		{"missing envelope", `{"data":{"items":[]}}`, 200},
		{"redirect", "", 302},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			var redirected atomic.Int32
			target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirected.Add(1) }))
			defer target.Close()
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Location", target.URL)
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.response))
			}))
			defer upstream.Close()
			t.Setenv("SUB2API_BASE_URL", upstream.URL)
			t.Setenv("SUB2API_ADMIN_KEY", "secret")
			t.Setenv("SUB2API_MONITOR_IDS", "")
			var source channelStatusSource
			for range 2 {
				_, err := source.get(context.Background())
				require.Error(t, err)
				assert.NotContains(t, err.Error(), "secret")
				assert.NotContains(t, err.Error(), upstream.URL)
			}
			assert.EqualValues(t, 1, calls.Load(), "upstream failures are cached briefly")
			assert.Zero(t, redirected.Load(), "credentials never follow redirects")
		})
	}
	t.Run("unconfigured", func(t *testing.T) {
		t.Setenv("SUB2API_BASE_URL", "")
		t.Setenv("SUB2API_ADMIN_KEY", "")
		snapshot, err := fetchChannelStatus(context.Background())
		require.NoError(t, err)
		assert.False(t, snapshot.Enabled)
		assert.Empty(t, snapshot.Items)
	})
	for _, address := range []string{"https://user:password@example.com", "http://example.com", "file:///tmp/test", "https://example.com?key=secret", "https://example.com#fragment"} {
		t.Run(address, func(t *testing.T) {
			t.Setenv("SUB2API_BASE_URL", address)
			t.Setenv("SUB2API_ADMIN_KEY", "secret")
			_, err := fetchChannelStatus(context.Background())
			require.Error(t, err)
			assert.NotContains(t, err.Error(), "secret")
		})
	}
	t.Run("invalid allowlist", func(t *testing.T) {
		t.Setenv("SUB2API_BASE_URL", "https://example.com")
		t.Setenv("SUB2API_ADMIN_KEY", "secret")
		t.Setenv("SUB2API_MONITOR_IDS", "1,oops")
		_, err := fetchChannelStatus(context.Background())
		require.ErrorContains(t, err, "monitor IDs")
	})
}
