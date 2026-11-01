package controller

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type emailHTTPTransport func(*http.Request) (*http.Response, error)

func (transport emailHTTPTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func configureEmailDelivery(t *testing.T, options map[string]string) {
	t.Helper()
	require.NoError(t, i18n.Init())
	common.OptionMapRWMutex.Lock()
	original := common.OptionMap
	common.OptionMap = options
	common.OptionMapRWMutex.Unlock()
	originalTransport := http.DefaultTransport
	originalFrom, originalAccount, originalServer := common.SMTPFrom, common.SMTPAccount, common.SMTPServer
	common.SMTPFrom, common.SMTPAccount, common.SMTPServer = "", "", ""
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = original
		common.OptionMapRWMutex.Unlock()
		http.DefaultTransport = originalTransport
		common.SMTPFrom, common.SMTPAccount, common.SMTPServer = originalFrom, originalAccount, originalServer
	})
}

func TestResendDeliversThroughSelectedProvider(t *testing.T) {
	configureEmailDelivery(t, map[string]string{"EmailProvider": "resend", "ResendApiKey": "test-key", "ResendFrom": "New API <sender@example.com>"})
	calls := 0
	http.DefaultTransport = emailHTTPTransport(func(request *http.Request) (*http.Response, error) {
		calls++
		assert.Equal(t, "https://api.resend.com/emails", request.URL.String())
		assert.Equal(t, http.MethodPost, request.Method)
		assert.Equal(t, "Bearer test-key", request.Header.Get("Authorization"))
		assert.Equal(t, "application/json", request.Header.Get("Content-Type"))
		_, hasDeadline := request.Context().Deadline()
		assert.True(t, hasDeadline, "email delivery must have a bounded wait")
		var body struct {
			From    string   `json:"from"`
			To      []string `json:"to"`
			Subject string   `json:"subject"`
			HTML    string   `json:"html"`
		}
		require.NoError(t, common.DecodeJson(request.Body, &body))
		assert.Equal(t, `"New API" <sender@example.com>`, body.From)
		assert.Equal(t, []string{"one@example.com", "two@example.com"}, body.To)
		assert.Equal(t, "验证码", body.Subject)
		assert.Equal(t, "<p>123456</p>", body.HTML)
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"id":"email-test-id"}`)), Header: make(http.Header)}, nil
	})
	require.NoError(t, common.SendEmail("验证码", "one@example.com; two@example.com", "<p>123456</p>"))
	assert.Equal(t, 1, calls, "no SMTP configuration is needed and no duplicate request is made")
}

func TestResendFailuresDoNotRetryFallbackOrExposeSensitiveContent(t *testing.T) {
	for _, status := range []int{302, 400, 401, 403, 429, 500} {
		t.Run(strconv.Itoa(status), func(t *testing.T) {
			configureEmailDelivery(t, map[string]string{"EmailProvider": "resend", "ResendApiKey": "test-key", "ResendFrom": "sender@example.com"})
			calls := 0
			http.DefaultTransport = emailHTTPTransport(func(request *http.Request) (*http.Response, error) {
				calls++
				return &http.Response{StatusCode: status, Header: http.Header{"Location": []string{"https://untrusted.example/emails"}}, Body: io.NopCloser(strings.NewReader(`{"message":"test-key 123456 reset-token"}`))}, nil
			})
			err := common.SendEmail("verification", "one@example.com", "123456 reset-token")
			require.EqualError(t, err, "Resend email delivery failed (HTTP "+strconv.Itoa(status)+")")
			assert.Equal(t, 1, calls, "do not retry or follow redirects")
		})
	}
}

func TestResendRejectsIncompleteOrInvalidConfigurationBeforeSending(t *testing.T) {
	tests := []struct{ name, key, from, receiver string }{
		{"missing key", "", "sender@example.com", "one@example.com"},
		{"header injection", "key\r\nInjected: value", "sender@example.com", "one@example.com"},
		{"missing sender", "test-key", "", "one@example.com"},
		{"invalid sender", "test-key", "bad-address", "one@example.com"},
		{"invalid recipient", "test-key", "sender@example.com", "bad-address"},
		{"empty recipient", "test-key", "sender@example.com", ""},
		{"too many recipients", "test-key", "sender@example.com", strings.Repeat("one@example.com;", 50) + "two@example.com"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			configureEmailDelivery(t, map[string]string{"EmailProvider": "resend", "ResendApiKey": test.key, "ResendFrom": test.from})
			http.DefaultTransport = emailHTTPTransport(func(*http.Request) (*http.Response, error) {
				t.Fatal("invalid settings must not make a request")
				return nil, errors.New("unexpected request")
			})
			err := common.SendEmail("verification", test.receiver, "123456")
			require.Error(t, err)
			assert.NotContains(t, err.Error(), "123456")
			assert.NotContains(t, err.Error(), "test-key")
		})
	}
}

func TestResendRejectsMalformedSuccessAndSanitizesTransportErrors(t *testing.T) {
	for _, body := range []string{`{}`, `not json`, `{"id":false}`, `{"id":""}`} {
		t.Run(body, func(t *testing.T) {
			configureEmailDelivery(t, map[string]string{"EmailProvider": "resend", "ResendApiKey": "test-key", "ResendFrom": "sender@example.com"})
			http.DefaultTransport = emailHTTPTransport(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
			})
			require.EqualError(t, common.SendEmail("verification", "one@example.com", "123456"), "Invalid Resend delivery response")
		})
	}
	configureEmailDelivery(t, map[string]string{"EmailProvider": "resend", "ResendApiKey": "test-key", "ResendFrom": "sender@example.com"})
	http.DefaultTransport = emailHTTPTransport(func(*http.Request) (*http.Response, error) { return nil, errors.New("test-key 123456 reset-token") })
	require.EqualError(t, common.SendEmail("verification", "one@example.com", "123456"), "Resend request failed")
}

func TestSMTPAndLegacyConfigurationNeverUseResend(t *testing.T) {
	for _, provider := range []string{"", "smtp", "invalid"} {
		t.Run("provider="+provider, func(t *testing.T) {
			configureEmailDelivery(t, map[string]string{"EmailProvider": provider, "ResendApiKey": "test-key", "ResendFrom": "sender@example.com"})
			http.DefaultTransport = emailHTTPTransport(func(*http.Request) (*http.Response, error) {
				t.Fatal("SMTP and unknown providers must not invoke Resend")
				return nil, errors.New("unexpected request")
			})
			require.Error(t, common.SendEmail("verification", "one@example.com", "123456"))
		})
	}
}

func TestEmailOptionsNeverReturnResendCredentials(t *testing.T) {
	configureEmailDelivery(t, map[string]string{"EmailProvider": "resend", "ResendApiKey": "private-email-credential", "ResendFrom": "sender@example.com"})
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/option/", nil)
	GetOptions(context)
	require.Equal(t, http.StatusOK, response.Code)
	assert.NotContains(t, response.Body.String(), "private-email-credential")
	assert.NotContains(t, response.Body.String(), "ResendApiKey")
	assert.Contains(t, response.Body.String(), "ResendFrom")
	assert.Contains(t, response.Body.String(), `"key":"ResendKeyConfigured","value":"true"`)
}

func TestEmailProviderOptionRejectsInvalidValues(t *testing.T) {
	for _, provider := range []string{"", "both", "SMTP", "smtp,resend"} {
		t.Run(provider, func(t *testing.T) {
			configureEmailDelivery(t, map[string]string{"EmailProvider": "smtp"})
			body, err := common.Marshal(OptionUpdateRequest{Key: "EmailProvider", Value: provider})
			require.NoError(t, err)
			response := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(response)
			context.Request = httptest.NewRequest(http.MethodPut, "/api/option/", strings.NewReader(string(body)))
			UpdateOption(context)
			assert.Contains(t, response.Body.String(), `"success":false`)
			assert.Contains(t, response.Body.String(), `"message_key":"Email sending method must be SMTP or Resend"`)
			assert.Equal(t, "smtp", common.OptionMap["EmailProvider"])
		})
	}
}

func TestEmailProviderCannotActivateIncompleteResend(t *testing.T) {
	for name, settings := range map[string]map[string]string{
		"missing key":    {"ResendFrom": "sender@example.com"},
		"missing sender": {"ResendApiKey": "test-key"},
		"invalid sender": {"ResendApiKey": "test-key", "ResendFrom": "invalid"},
		"invalid key":    {"ResendApiKey": "key\r\nInjected: value", "ResendFrom": "sender@example.com"},
	} {
		t.Run(name, func(t *testing.T) {
			settings["EmailProvider"] = "smtp"
			configureEmailDelivery(t, settings)
			response := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(response)
			context.Request = httptest.NewRequest(http.MethodPut, "/api/option/", strings.NewReader(`{"key":"EmailProvider","value":"resend"}`))
			require.NotPanics(t, func() { UpdateOption(context) }, "invalid activation must fail before accessing storage")
			assert.Contains(t, response.Body.String(), `"success":false`)
			assert.Contains(t, response.Body.String(), `"message_key":"Resend `)
			assert.Equal(t, "smtp", common.OptionMap["EmailProvider"])
			assert.NotContains(t, response.Body.String(), "test-key")
		})
	}
}

func TestResendSettingsChangesKeepActiveDeliveryWorking(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Option{}))
	previousDB, previousRedis := model.DB, common.RedisEnabled
	model.DB, common.RedisEnabled = db, false
	t.Cleanup(func() { model.DB, common.RedisEnabled = previousDB, previousRedis })

	tests := []struct {
		name, provider, key, value string
		saved                      bool
	}{
		{"active sender the parser rejects", "resend", "ResendFrom", "notify..team@example.com", false},
		{"active key cleared", "resend", "ResendApiKey", " ", false},
		{"active sender renamed", "resend", "ResendFrom", `"New API" <notify@example.com>`, true},
		{"inactive sender saved before its key", "smtp", "ResendFrom", "notify@example.com", true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			settings := map[string]string{"EmailProvider": test.provider, "ResendApiKey": "test-key", "ResendFrom": "sender@example.com"}
			if test.provider == "smtp" {
				settings["ResendApiKey"] = ""
			}
			configureEmailDelivery(t, settings)
			before := settings[test.key]
			body, err := common.Marshal(OptionUpdateRequest{Key: test.key, Value: test.value})
			require.NoError(t, err)
			response := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(response)
			context.Request = httptest.NewRequest(http.MethodPut, "/api/option/", strings.NewReader(string(body)))
			UpdateOption(context)
			if test.saved {
				assert.Contains(t, response.Body.String(), `"success":true`)
				assert.Equal(t, test.value, common.OptionMap[test.key])
				return
			}
			assert.Contains(t, response.Body.String(), `"message_key":"Resend `)
			assert.Equal(t, before, common.OptionMap[test.key])
		})
	}
}

func TestEmailKeyStatusIsDerivedAndReadOnly(t *testing.T) {
	configureEmailDelivery(t, map[string]string{"EmailProvider": "smtp", "ResendKeyConfigured": "true"})
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/option/", nil)
	GetOptions(context)
	assert.Contains(t, response.Body.String(), `"key":"ResendKeyConfigured","value":"false"`)
	assert.NotContains(t, response.Body.String(), `"value":"true"`)

	response = httptest.NewRecorder()
	context, _ = gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(http.MethodPut, "/api/option/", strings.NewReader(`{"key":"ResendKeyConfigured","value":true}`))
	UpdateOption(context)
	assert.Contains(t, response.Body.String(), `"success":false`)
	assert.Contains(t, response.Body.String(), "read-only")
}

func TestSendTestEmailUsesSavedProviderAndFixedTemplate(t *testing.T) {
	require.NoError(t, i18n.Init())
	for _, provider := range []string{"smtp", "resend"} {
		t.Run(provider, func(t *testing.T) {
			configureEmailDelivery(t, map[string]string{"EmailProvider": provider, "ResendApiKey": "test-key", "ResendFrom": "sender@example.com"})
			var mailbox *securityMailbox
			if provider == "smtp" {
				mailbox = newSecurityMailbox(t)
			}
			calls := 0
			http.DefaultTransport = emailHTTPTransport(func(request *http.Request) (*http.Response, error) {
				calls++
				var payload struct {
					To      []string `json:"to"`
					Subject string   `json:"subject"`
					HTML    string   `json:"html"`
				}
				require.NoError(t, common.DecodeJson(request.Body, &payload))
				assert.Equal(t, []string{"person@example.com"}, payload.To)
				assert.Contains(t, payload.Subject, "Test email")
				assert.Contains(t, payload.HTML, "resend")
				assert.NotContains(t, payload.HTML, "injected content")
				return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"id":"test"}`))}, nil
			})
			response := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(response)
			c.Request = httptest.NewRequest("POST", "/api/option/email/test", strings.NewReader(`{"recipient":"person@example.com","content":"injected content"}`))
			c.Request.Header.Set("Accept-Language", "en")
			SendTestEmail(c)
			assert.Contains(t, response.Body.String(), `"success":true`)
			if provider == "resend" {
				assert.Equal(t, 1, calls)
				return
			}
			mailbox.mutex.Lock()
			defer mailbox.mutex.Unlock()
			require.Len(t, mailbox.mail["person@example.com"], 1)
			assert.Contains(t, mailbox.mail["person@example.com"][0], "smtp")
			assert.NotContains(t, mailbox.mail["person@example.com"][0], "injected content")
			assert.Zero(t, calls)
		})
	}
}

func TestSendTestEmailRejectsInvalidRecipientsWithoutDelivery(t *testing.T) {
	configureEmailDelivery(t, map[string]string{"EmailProvider": "resend", "ResendApiKey": "test-key", "ResendFrom": "sender@example.com"})
	http.DefaultTransport = emailHTTPTransport(func(*http.Request) (*http.Response, error) {
		t.Fatal("invalid recipient must not send")
		return nil, errors.New("unexpected delivery")
	})
	for _, recipient := range []string{"", "invalid", "a@example.com;b@example.com", "a@example.com,b@example.com", "Name <a@example.com>", "a@example.com\r\nBcc: b@example.com", "a@example.com\x00"} {
		t.Run(recipient, func(t *testing.T) {
			body, err := common.Marshal(map[string]string{"recipient": recipient})
			require.NoError(t, err)
			response := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(response)
			c.Request = httptest.NewRequest("POST", "/api/option/email/test", strings.NewReader(string(body)))
			SendTestEmail(c)
			assert.Contains(t, response.Body.String(), `"success":false`)
			assert.Contains(t, response.Body.String(), "Invalid email address")
		})
	}
}

func TestSendTestEmailReportsFailureWithoutSecretsOrRetry(t *testing.T) {
	configureEmailDelivery(t, map[string]string{"EmailProvider": "resend", "ResendApiKey": "test-key", "ResendFrom": "sender@example.com"})
	calls := 0
	http.DefaultTransport = emailHTTPTransport(func(*http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 401, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"message":"test-key"}`))}, nil
	})
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = httptest.NewRequest("POST", "/api/option/email/test", strings.NewReader(`{"recipient":"person@example.com"}`))
	SendTestEmail(c)
	assert.Contains(t, response.Body.String(), `"success":false`)
	assert.Contains(t, response.Body.String(), "401")
	assert.NotContains(t, response.Body.String(), "test-key")
	assert.Equal(t, 1, calls)
}

func TestSendTestEmailRequiresRootAndLimitsEachOperator(t *testing.T) {
	user, identity := setupSecurityEnrollmentTest(t)
	previousRDB := common.RDB
	redisServer := miniredis.RunT(t)
	common.RDB = redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	common.RedisEnabled = true
	t.Cleanup(func() { _ = common.RDB.Close(); common.RDB = previousRDB })
	configureEmailDelivery(t, map[string]string{"EmailProvider": "resend", "ResendApiKey": "test-key", "ResendFrom": "sender@example.com"})
	calls := 0
	http.DefaultTransport = emailHTTPTransport(func(*http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"id":"test"}`))}, nil
	})
	router := gin.New()
	router.POST("/api/option/email/test", middleware.RootAuth(), middleware.EmailTestRateLimit(), SendTestEmail)
	token, _, err := service.IssueAccessToken(identity)
	require.NoError(t, err)
	for _, credential := range []string{"", token} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest("POST", "/api/option/email/test", strings.NewReader(`{"recipient":"person@example.com"}`))
		if credential != "" {
			request.Header.Set("Authorization", "Bearer "+credential)
		}
		router.ServeHTTP(response, request)
		assert.Contains(t, []int{401, 403}, response.Code)
	}
	assert.Zero(t, calls)
	require.NoError(t, model.DB.Model(user).Update("role", common.RoleRootUser).Error)
	require.NoError(t, model.PublishUserAuthCache(user.Id))
	for attempt := range 4 {
		response := httptest.NewRecorder()
		request := httptest.NewRequest("POST", "/api/option/email/test", strings.NewReader(`{"recipient":"person@example.com"}`))
		request.Header.Set("Authorization", "Bearer "+token)
		router.ServeHTTP(response, request)
		if attempt < 3 {
			assert.Equal(t, 200, response.Code)
			assert.Contains(t, response.Body.String(), `"success":true`)
		} else {
			assert.Equal(t, 429, response.Code)
			assert.NotEmpty(t, response.Header().Get("Retry-After"))
		}
	}

	other := &model.User{Username: "other-mail-operator", AffCode: "email-test-other", Role: common.RoleRootUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1}
	require.NoError(t, model.DB.Create(other).Error)
	bundle, err := service.CreateLoginSession(other.Id, "password", "127.0.0.1", "test-mail")
	require.NoError(t, err)
	response := httptest.NewRecorder()
	request := httptest.NewRequest("POST", "/api/option/email/test", strings.NewReader(`{"recipient":"other@example.com"}`))
	request.Header.Set("Authorization", "Bearer "+bundle.AccessToken)
	router.ServeHTTP(response, request)
	assert.Equal(t, 200, response.Code)
	assert.Contains(t, response.Body.String(), `"success":true`)
	assert.Equal(t, 4, calls)
}

func TestSendTestEmailSanitizesSMTPAuthenticationFailure(t *testing.T) {
	configureEmailDelivery(t, map[string]string{"EmailProvider": "smtp"})
	newSecurityMailbox(t)
	// An SMTP peer can put arbitrary text into a failure response.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer listener.Close()
	common.SMTPPort = listener.Addr().(*net.TCPAddr).Port
	done := make(chan struct{})
	go func() {
		defer close(done)
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		_, _ = io.WriteString(conn, "535 account-password-must-not-leak\r\n")
	}()
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = httptest.NewRequest("POST", "/api/option/email/test", strings.NewReader(`{"recipient":"person@example.com"}`))
	SendTestEmail(c)
	<-done
	assert.Contains(t, response.Body.String(), `"success":false`)
	assert.Contains(t, response.Body.String(), "SMTP authentication failed")
	assert.NotContains(t, response.Body.String(), "account-password-must-not-leak")
}

func TestSendTestEmailReportsCanceledDeliveryAsUnconfirmed(t *testing.T) {
	configureEmailDelivery(t, map[string]string{"EmailProvider": "smtp"})
	newSecurityMailbox(t)
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	parent, cancel := context.WithCancel(context.Background())
	cancel()
	c.Request = httptest.NewRequest("POST", "/api/option/email/test", strings.NewReader(`{"recipient":"person@example.com"}`)).WithContext(parent)
	SendTestEmail(c)
	assert.Contains(t, response.Body.String(), `"success":false`)
	assert.Contains(t, response.Body.String(), "Email delivery could not be confirmed")
}
