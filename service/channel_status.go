package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"golang.org/x/sync/errgroup"
	"golang.org/x/sync/singleflight"
)

// ChannelStatusPoint deliberately excludes upstream messages, headers and quota data.
type ChannelStatusPoint struct {
	Status        string `json:"status"`
	LatencyMS     *int   `json:"latency_ms"`
	PingLatencyMS *int   `json:"ping_latency_ms"`
	CheckedAt     string `json:"checked_at"`
}

type ChannelStatusItem struct {
	ID                   int64                `json:"id"`
	Name                 string               `json:"name"`
	Provider             string               `json:"provider"`
	PrimaryModel         string               `json:"primary_model"`
	PrimaryStatus        string               `json:"primary_status"`
	PrimaryLatencyMS     *int                 `json:"primary_latency_ms"`
	Availability7d       float64              `json:"availability_7d"`
	PrimaryPingLatencyMS *int                 `json:"primary_ping_latency_ms"`
	Timeline             []ChannelStatusPoint `json:"timeline"`
}

type ChannelStatusSnapshot struct {
	Enabled   bool                `json:"enabled"`
	UpdatedAt string              `json:"updated_at"`
	Items     []ChannelStatusItem `json:"items"`
}

// channelStatusSource shares snapshots (including short-lived failures) across visitors.
type channelStatusSource struct {
	mu       sync.Mutex
	flight   singleflight.Group
	snapshot ChannelStatusSnapshot
	err      error
	expires  time.Time
}

var publicChannelStatus channelStatusSource

func ChannelStatusEnabled() bool {
	return strings.TrimSpace(os.Getenv("SUB2API_BASE_URL")) != "" && strings.TrimSpace(os.Getenv("SUB2API_ADMIN_KEY")) != ""
}

func GetChannelStatus(ctx context.Context) (ChannelStatusSnapshot, error) {
	return publicChannelStatus.get(ctx)
}

func (s *channelStatusSource) get(ctx context.Context) (ChannelStatusSnapshot, error) {
	result := s.flight.DoChan("snapshot", func() (any, error) {
		s.mu.Lock()
		defer s.mu.Unlock()
		if time.Now().Before(s.expires) {
			return s.snapshot, s.err
		}
		// The shared refresh must survive a single visitor disconnecting.
		refreshCtx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		s.snapshot, s.err = fetchChannelStatus(refreshCtx)
		ttl := 30 * time.Second
		if s.err != nil {
			ttl = 10 * time.Second
		}
		s.expires = time.Now().Add(ttl)
		return s.snapshot, s.err
	})
	select {
	case <-ctx.Done():
		return ChannelStatusSnapshot{}, ctx.Err()
	case r := <-result:
		if r.Err != nil {
			return ChannelStatusSnapshot{}, r.Err
		}
		return r.Val.(ChannelStatusSnapshot), nil
	}
}

// sub2apiMonitor decodes only the fields permitted on the public status page.
type sub2apiMonitor struct {
	ChannelStatusItem
	Enabled bool `json:"enabled"`
}

func fetchChannelStatus(ctx context.Context) (ChannelStatusSnapshot, error) {
	snapshot := ChannelStatusSnapshot{Enabled: ChannelStatusEnabled(), Items: []ChannelStatusItem{}}
	if !snapshot.Enabled {
		return snapshot, nil
	}
	base, err := url.Parse(strings.TrimRight(strings.TrimSpace(os.Getenv("SUB2API_BASE_URL")), "/"))
	if err != nil || base.Host == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return snapshot, errors.New("invalid sub2api base URL")
	}
	// Credentials require TLS outside explicitly configured local/private networks.
	ip := net.ParseIP(base.Hostname())
	local := base.Hostname() == "localhost" || (ip != nil && (ip.IsLoopback() || ip.IsPrivate()))
	if base.Scheme != "https" && !(base.Scheme == "http" && local) {
		return snapshot, errors.New("sub2api requires HTTPS outside local networks")
	}
	allowed := map[int64]bool{}
	for raw := range strings.SplitSeq(os.Getenv("SUB2API_MONITOR_IDS"), ",") {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		id, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
		if err != nil || id <= 0 {
			return snapshot, errors.New("invalid sub2api monitor IDs")
		}
		allowed[id] = true
	}
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	key := strings.TrimSpace(os.Getenv("SUB2API_ADMIN_KEY"))
	monitors := []sub2apiMonitor{}
	for page := 1; ; page++ {
		var data struct {
			Items []sub2apiMonitor `json:"items"`
			Total int              `json:"total"`
		}
		path := fmt.Sprintf("/api/v1/admin/channel-monitors?page=%d&page_size=100&enabled=true", page)
		if err := readSub2API(ctx, client, base.String()+path, key, &data); err != nil {
			return snapshot, err
		}
		for _, item := range data.Items {
			if item.Enabled && (len(allowed) == 0 || allowed[item.ID]) {
				monitors = append(monitors, item)
			}
		}
		if page*100 >= data.Total {
			break
		}
		if len(data.Items) == 0 || page >= 100 {
			return snapshot, errors.New("invalid sub2api pagination")
		}
	}
	snapshot.Items = make([]ChannelStatusItem, len(monitors))
	group, groupCtx := errgroup.WithContext(ctx)
	group.SetLimit(6)
	for i, monitor := range monitors {
		group.Go(func() error {
			item := monitor.ChannelStatusItem
			item.Timeline = []ChannelStatusPoint{}
			// An empty primary model must not accidentally mix extra models into the timeline.
			if item.PrimaryModel != "" {
				var history struct {
					Items []ChannelStatusPoint `json:"items"`
				}
				path := fmt.Sprintf("/api/v1/admin/channel-monitors/%d/history?limit=60&model=%s", item.ID, url.QueryEscape(item.PrimaryModel))
				if err := readSub2API(groupCtx, client, base.String()+path, key, &history); err != nil {
					return err
				}
				slices.SortStableFunc(history.Items, func(a, b ChannelStatusPoint) int { return strings.Compare(a.CheckedAt, b.CheckedAt) })
				if len(history.Items) > 60 {
					history.Items = history.Items[len(history.Items)-60:]
				}
				item.Timeline = append(item.Timeline, history.Items...)
				if len(item.Timeline) > 0 {
					item.PrimaryPingLatencyMS = item.Timeline[len(item.Timeline)-1].PingLatencyMS
				}
			}
			snapshot.Items[i] = item
			return nil
		})
	}
	if err := group.Wait(); err != nil {
		return snapshot, err
	}
	snapshot.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return snapshot, nil
}

// readSub2API never returns upstream bodies or transport errors containing credentials/URLs.
func readSub2API(ctx context.Context, client *http.Client, endpoint, key string, target any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return errors.New("invalid sub2api request")
	}
	req.Header.Set("x-api-key", key)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return errors.New("sub2api request failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("sub2api returned HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, (4<<20)+1))
	if err != nil || len(body) > 4<<20 {
		return errors.New("invalid sub2api response size")
	}
	var envelope struct {
		Code *int              `json:"code"`
		Data common.RawMessage `json:"data"`
	}
	if common.Unmarshal(body, &envelope) != nil || envelope.Code == nil || *envelope.Code != 0 || len(envelope.Data) == 0 {
		return errors.New("invalid sub2api response")
	}
	if common.Unmarshal(envelope.Data, target) != nil {
		return errors.New("invalid sub2api data")
	}
	return nil
}
