package controller

import (
	"context"
	"errors"
	"html"
	"net"
	"net/http"
	"net/mail"
	"net/textproto"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/gin-gonic/gin"
)

// SendTestEmail sends only a fixed template using the saved provider settings.
// RootAuth and EmailTestRateLimit are required on its management route.
func SendTestEmail(c *gin.Context) {
	var request struct {
		Recipient string `json:"recipient"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorT(c, "Invalid email address")
		return
	}
	recipient := strings.TrimSpace(request.Recipient)
	address, err := mail.ParseAddress(recipient)
	if err != nil || address.Address != recipient || strings.ContainsAny(recipient, "\r\n\x00,;") || len(recipient) > 254 {
		common.ApiErrorT(c, "Invalid email address")
		return
	}
	common.OptionMapRWMutex.RLock()
	provider := common.OptionMap["EmailProvider"]
	common.OptionMapRWMutex.RUnlock()
	if provider == "" {
		provider = "smtp"
	}
	if provider == "smtp" && (common.SMTPServer == "" || (common.SMTPFrom == "" && common.SMTPAccount == "")) {
		common.ApiErrorT(c, "SMTP server is not configured")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	subject := i18n.T(c, "email.test.subject", map[string]any{"SystemName": common.SystemName})
	content := i18n.T(c, "email.test.body", map[string]any{
		"SystemName": html.EscapeString(common.SystemName),
		"Provider":   html.EscapeString(provider),
		"Time":       time.Now().UTC().Format(time.RFC3339),
	})
	err = common.SendEmailContext(ctx, subject, recipient, content)
	result := "accepted"
	if err != nil {
		result = "Email test failed. Check the saved configuration and mail service logs."
		var timeout net.Error
		var reply *textproto.Error
		var message *common.Message
		switch {
		case ctx.Err() != nil || (errors.As(err, &timeout) && timeout.Timeout()):
			result = "Email delivery could not be confirmed. Check the inbox before sending again."
		case errors.As(err, &reply):
			switch reply.Code {
			case 530, 534, 535, 538:
				result = "SMTP authentication failed. Check the account and password or authorization code."
			case 550, 551, 553:
				result = "SMTP rejected the sender or recipient address."
			}
		case errors.As(err, &message):
			// Structured delivery errors contain fixed messages and safe status codes.
			common.ApiError(c, message)
			common.SysLog(common.LogText("Email test: operator=%d recipient=%s provider=%s result=%s", c.GetInt("id"), "***@"+strings.SplitN(recipient, "@", 2)[1], provider, message.Key))
			return
		}
	}
	// Do not log raw SMTP errors: the peer may echo credentials or addresses.
	common.SysLog(common.LogText("Email test: operator=%d recipient=%s provider=%s result=%s", c.GetInt("id"), "***@"+strings.SplitN(recipient, "@", 2)[1], provider, result))
	if err != nil {
		common.ApiErrorT(c, result)
		return
	}
	common.ApiSuccess(c, nil)
}
