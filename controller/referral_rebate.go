package controller

import (
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func referralRebateRequest(c *gin.Context, ownerID int) (model.ReferralRebateFilter, *common.PageInfo, bool) {
	filter := model.ReferralRebateFilter{InviterID: ownerID, Status: c.Query("status"), StartDay: c.Query("start_date"), EndDay: c.Query("end_date")}
	now := time.Now().In(time.FixedZone("Asia/Shanghai", 8*3600))
	if filter.EndDay == "" {
		filter.EndDay = now.Format("2006-01-02")
	}
	if filter.StartDay == "" {
		filter.StartDay = now.AddDate(0, 0, -30).Format("2006-01-02")
	}
	start, e1 := time.Parse("2006-01-02", filter.StartDay)
	end, e2 := time.Parse("2006-01-02", filter.EndDay)
	if e1 != nil || e2 != nil || end.Before(start) || end.Sub(start) > 366*24*time.Hour {
		common.ApiErrorT(c, "Choose a valid date range of at most 366 days")
		return filter, nil, false
	}
	if ownerID == 0 && c.Query("inviter_id") != "" {
		id, err := strconv.Atoi(c.Query("inviter_id"))
		if err != nil || id <= 0 {
			common.ApiErrorT(c, "Invalid user ID")
			return filter, nil, false
		}
		filter.InviterID = id
	}
	if c.Query("payer_id") != "" {
		id, err := strconv.Atoi(c.Query("payer_id"))
		if err != nil || id <= 0 {
			common.ApiErrorT(c, "Invalid user ID")
			return filter, nil, false
		}
		filter.PayerID = id
	}
	switch filter.Status {
	case "", "pending", "credited", "disabled", "zero", "review", "reversed":
	default:
		common.ApiErrorT(c, "Invalid rebate status")
		return filter, nil, false
	}
	page := common.GetPageQuery(c)
	page.PageSize = max(1, page.PageSize)
	page.Page = min(max(1, page.Page), int(^uint(0)>>1)/page.PageSize)
	return filter, page, true
}

func GetSelfReferralRebates(c *gin.Context) {
	identity, ok := requireBrowserSession(c)
	if !ok {
		return
	}
	listReferralRebates(c, identity.UserID)
}

func GetAdminReferralRebates(c *gin.Context) { listReferralRebates(c, 0) }

func listReferralRebates(c *gin.Context, ownerID int) {
	filter, page, ok := referralRebateRequest(c, ownerID)
	if !ok {
		return
	}
	entries, total, err := model.ListReferralRebates(filter, page)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	page.SetItems(entries)
	page.SetTotal(int(total))
	common.ApiSuccess(c, page)
}

func GetAdminReferralRebateDaily(c *gin.Context) {
	filter, page, ok := referralRebateRequest(c, 0)
	if !ok {
		return
	}
	items, total, summary, err := model.GetReferralRebateDaily(filter, page)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	page.SetItems(items)
	page.SetTotal(total)
	common.ApiSuccess(c, gin.H{"items": items, "total": total, "page": page.Page, "page_size": page.PageSize, "summary": summary})
}

func GetReferralRebateSettings(c *gin.Context) {
	policy, err := model.GetReferralRebatePolicy()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, policy)
}

func SaveReferralRebateSettings(c *gin.Context) {
	identity, ok := requireBrowserSession(c)
	if !ok {
		return
	}
	var request struct {
		Enabled *bool `json:"enabled"`
		RateBPS *int  `json:"rate_bps"`
	}
	if err := c.ShouldBindJSON(&request); err != nil || request.Enabled == nil || request.RateBPS == nil {
		common.ApiErrorT(c, "Invalid rebate settings")
		return
	}
	policy, err := model.SaveReferralRebatePolicy(*request.Enabled, *request.RateBPS, identity.UserID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "referral_rebate.settings", map[string]any{"enabled": policy.Enabled, "rate_bps": policy.RateBPS, "version": policy.Version})
	common.ApiSuccess(c, policy)
}

func RetryReferralRebate(c *gin.Context) {
	if _, ok := requireBrowserSession(c); !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid rebate record")
		return
	}
	if err := model.DeliverReferralRebate(id); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "referral_rebate.retry", map[string]any{"rebate_id": id})
	c.JSON(http.StatusOK, gin.H{"success": true, "data": nil})
}

func ReverseReferralRebate(c *gin.Context) {
	identity, ok := requireBrowserSession(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid rebate record")
		return
	}
	var request struct {
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiErrorT(c, "A reversal reason of at most 200 characters is required")
		return
	}
	if err := model.ReverseReferralRebate(id, identity.UserID, request.Reason); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "referral_rebate.reverse", map[string]any{"rebate_id": id, "reason": request.Reason})
	common.ApiSuccess(c, nil)
}
