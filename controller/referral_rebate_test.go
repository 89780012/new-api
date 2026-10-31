package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// This is the TopUp schema in the released v1.0.0-rc.47.2. Upgrade tests
// seed a paid order before introducing the payment snapshots and rebate ledger.
type releasedTopUpSchema struct {
	Id              int
	UserId          int `gorm:"index"`
	Amount          int64
	Money           float64
	TradeNo         string `gorm:"unique;type:varchar(255);index"`
	PaymentMethod   string `gorm:"type:varchar(50)"`
	PaymentProvider string `gorm:"type:varchar(50);default:''"`
	CreateTime      int64
	CompleteTime    int64
	Status          string
}

func (releasedTopUpSchema) TableName() string { return "top_ups" }

func rebateTestDB(t *testing.T) (*gorm.DB, model.User, model.User) {
	t.Helper()
	db := setupManageUserTestDB(t)
	for range 2 {
		require.NoError(t, db.AutoMigrate(&model.TopUp{}, &model.ReferralRebatePolicy{}, &model.ReferralRebate{}))
	}
	inviter := model.User{Username: "rebate-inviter", AffCode: "rebate-inviter", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1, Quota: 10000000}
	require.NoError(t, db.Create(&inviter).Error)
	payer := model.User{Username: "rebate-payer", AffCode: "rebate-payer", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1, InviterId: inviter.Id}
	require.NoError(t, db.Create(&payer).Error)
	return db, inviter, payer
}

func rebateOrder(t *testing.T, db *gorm.DB, payer int, trade string, paid string) model.TopUp {
	t.Helper()
	order := model.TopUp{UserId: payer, Amount: 100, Money: 100, TradeNo: trade, PaymentProvider: model.PaymentProviderEpay, PaymentMethod: "alipay", Status: common.TopUpStatusPending, CreateTime: time.Now().Unix()}
	order.SnapshotPayment("CNY", decimal.RequireFromString(paid), decimal.NewFromInt(1))
	require.NoError(t, db.Create(&order).Error)
	return order
}

func TestReferralRebateReleasedSchemaUpgradeIsIdempotent(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&releasedTopUpSchema{}))
	original := releasedTopUpSchema{UserId: 42, Amount: 100, Money: 90, TradeNo: "released-paid-order", PaymentProvider: model.PaymentProviderEpay, Status: common.TopUpStatusSuccess, CreateTime: 1700000000, CompleteTime: 1700000010}
	require.NoError(t, db.Create(&original).Error)
	for range 2 {
		require.NoError(t, db.AutoMigrate(&model.TopUp{}, &model.ReferralRebatePolicy{}, &model.ReferralRebate{}))
	}
	var upgraded model.TopUp
	require.NoError(t, db.First(&upgraded, original.Id).Error)
	assert.Equal(t, original.Amount, upgraded.Amount)
	assert.Equal(t, original.Money, upgraded.Money)
	assert.Equal(t, original.Status, upgraded.Status)
	assert.Empty(t, upgraded.PaidMoney, "historical money must not be guessed from provider-specific Money")
	assert.Empty(t, upgraded.PaymentCurrency)
	var count int64
	require.NoError(t, db.Model(&model.ReferralRebate{}).Count(&count).Error)
	assert.Zero(t, count, "upgrades must not retroactively issue rebates")
	duplicate := model.TopUp{TradeNo: original.TradeNo}
	assert.Error(t, db.Create(&duplicate).Error, "the existing unique order constraint must survive")
	policy, err := model.GetReferralRebatePolicy()
	require.NoError(t, err)
	assert.False(t, policy.Enabled)
}

func TestReferralRebatePerPaymentSnapshotsRetryAndReversal(t *testing.T) {
	db, inviter, payer := rebateTestDB(t)
	_, err := model.SaveReferralRebatePolicy(true, 500, inviter.Id)
	require.NoError(t, err)
	order := rebateOrder(t, db, payer.Id, "first-payment", "90")
	done, err := model.RechargeEpay(order.TradeNo, "alipay", "")
	require.NoError(t, err)
	assert.False(t, done)
	var entry model.ReferralRebate
	require.NoError(t, db.Where("top_up_id = ?", order.Id).First(&entry).Error)
	assert.Equal(t, 2250000, entry.RebateQuota, "5% of actual 90, excluding the 10-unit recharge discount")
	require.NotNil(t, entry.BalanceBefore)
	require.NotNil(t, entry.BalanceAfter)
	assert.Equal(t, 10000000, *entry.BalanceBefore)
	assert.Equal(t, 12250000, *entry.BalanceAfter)
	assert.Equal(t, "credited", entry.Status)
	assert.Equal(t, "90", entry.PaidMoney)
	require.NoError(t, db.First(&payer, payer.Id).Error)
	assert.Equal(t, 50000000, payer.Quota, "the payer gets only its original purchased quota")
	_, err = model.SaveReferralRebatePolicy(true, 1000, inviter.Id)
	require.NoError(t, err)
	done, err = model.RechargeEpay(order.TradeNo, "alipay", "")
	require.NoError(t, err)
	assert.True(t, done)
	require.NoError(t, db.First(&inviter, inviter.Id).Error)
	assert.Equal(t, 12250000, inviter.Quota, "duplicate callback must not use the new rate or credit again")
	require.NoError(t, db.First(&entry, entry.ID).Error)
	assert.Equal(t, 500, entry.RateBPS)
	next := rebateOrder(t, db, payer.Id, "second-payment", "100")
	_, err = model.RechargeEpay(next.TradeNo, "alipay", "", model.PaymentReceipt{Money: "80", Currency: "CNY"})
	require.NoError(t, err)
	var nextEntry model.ReferralRebate
	require.NoError(t, db.Where("top_up_id = ?", next.Id).First(&nextEntry).Error)
	assert.Equal(t, "80", nextEntry.PaidMoney)
	assert.Equal(t, 4000000, nextEntry.RebateQuota)
	require.NotNil(t, nextEntry.BalanceBefore)
	assert.Equal(t, 12250000, *nextEntry.BalanceBefore)
	require.NotNil(t, nextEntry.BalanceAfter)
	assert.Equal(t, 16250000, *nextEntry.BalanceAfter)
	require.NoError(t, model.ReverseReferralRebate(entry.ID, inviter.Id, "Payment refund approved"))
	require.NoError(t, model.ReverseReferralRebate(entry.ID, inviter.Id, "Duplicate refund request"))
	require.NoError(t, db.First(&inviter, inviter.Id).Error)
	assert.Equal(t, 14000000, inviter.Quota)
	var reversal model.ReferralRebate
	require.NoError(t, db.Where("original_id = ?", entry.ID).First(&reversal).Error)
	assert.Equal(t, -2250000, reversal.RebateQuota)
	require.NotNil(t, reversal.BalanceBefore)
	assert.Equal(t, 16250000, *reversal.BalanceBefore)
	require.NotNil(t, reversal.BalanceAfter)
	assert.Equal(t, 14000000, *reversal.BalanceAfter)
	assert.NotEmpty(t, reversal.Day)
	daily, total, summary, err := model.GetReferralRebateDaily(model.ReferralRebateFilter{InviterID: inviter.Id}, &common.PageInfo{Page: 1, PageSize: 20})
	require.NoError(t, err)
	require.Equal(t, 1, total)
	require.Len(t, daily, 1)
	assert.Equal(t, "170", daily[0].PaidMoney, "a reversal is not a second recharge")
	assert.Equal(t, "4000000", daily[0].RebateQuota)
	assert.Equal(t, 2, daily[0].Count)
	require.Len(t, summary, 1)
	assert.Equal(t, "4000000", summary[0].RebateQuota)
}

func TestReferralRebateUnavailableWalletDoesNotBlockRecharge(t *testing.T) {
	db, inviter, payer := rebateTestDB(t)
	_, err := model.SaveReferralRebatePolicy(true, 500, inviter.Id)
	require.NoError(t, err)
	require.NoError(t, db.Model(&inviter).Update("quota", common.MaxWalletQuota).Error)
	order := rebateOrder(t, db, payer.Id, "full-wallet", "100")
	_, err = model.RechargeEpay(order.TradeNo, "alipay", "")
	require.NoError(t, err)
	var entry model.ReferralRebate
	require.NoError(t, db.Where("top_up_id = ?", order.Id).First(&entry).Error)
	assert.Equal(t, "pending", entry.Status)
	assert.Nil(t, entry.BalanceBefore)
	assert.Nil(t, entry.BalanceAfter)
	require.NoError(t, db.First(&payer, payer.Id).Error)
	assert.Equal(t, 50000000, payer.Quota)
	require.NoError(t, db.Model(&inviter).Updates(map[string]any{"quota": 10000000, "status": common.UserStatusDisabled}).Error)
	model.RetryPendingReferralRebates()
	require.NoError(t, db.First(&entry, entry.ID).Error)
	assert.Equal(t, "pending", entry.Status)
	require.NoError(t, db.Model(&inviter).Update("status", common.UserStatusEnabled).Error)
	model.RetryPendingReferralRebates()
	model.RetryPendingReferralRebates()
	require.NoError(t, db.First(&entry, entry.ID).Error)
	assert.Equal(t, "credited", entry.Status)
	require.NotNil(t, entry.BalanceBefore)
	assert.Equal(t, 10000000, *entry.BalanceBefore)
	require.NotNil(t, entry.BalanceAfter)
	assert.Equal(t, 12500000, *entry.BalanceAfter)
	require.NoError(t, db.First(&inviter, inviter.Id).Error)
	assert.Equal(t, 12500000, inviter.Quota)
	require.NoError(t, db.Model(&inviter).Update("quota", 0).Error)
	assert.Error(t, model.ReverseReferralRebate(entry.ID, inviter.Id, "Refund"))
	require.NoError(t, db.First(&entry, entry.ID).Error)
	assert.Equal(t, "credited", entry.Status)
}

func TestReferralRebateDisabledAndInvalidPaymentsNeverCredit(t *testing.T) {
	db, inviter, payer := rebateTestDB(t)
	for _, tc := range []struct {
		name                  string
		enabled               bool
		paid, price, currency string
		status                string
	}{
		{"disabled", false, "100", "1", "CNY", "disabled"},
		{"zero payment", true, "0", "1", "CNY", "zero"},
		{"fraction below one quota unit", true, "0.00003999999999999999", "1", "CNY", "zero"},
		{"missing snapshot", true, "", "", "", "review"},
		{"negative money", true, "-1", "1", "CNY", "review"},
		{"overflow", true, "99999999999999999999999", "1", "CNY", "review"},
		{"zero exchange price", true, "100", "0", "CNY", "review"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := model.SaveReferralRebatePolicy(tc.enabled, 500, inviter.Id)
			require.NoError(t, err)
			order := rebateOrder(t, db, payer.Id, "invalid-"+tc.name, "100")
			require.NoError(t, db.Model(&order).Updates(map[string]any{"paid_money": tc.paid, "payment_unit_price": tc.price, "payment_currency": tc.currency}).Error)
			_, err = model.RechargeEpay(order.TradeNo, "alipay", "")
			require.NoError(t, err)
			var entry model.ReferralRebate
			require.NoError(t, db.Where("top_up_id = ?", order.Id).First(&entry).Error)
			assert.Equal(t, tc.status, entry.Status)
			assert.Zero(t, entry.RebateQuota)
		})
	}
	require.NoError(t, db.First(&inviter, inviter.Id).Error)
	assert.Equal(t, 10000000, inviter.Quota)
	for _, rate := range []int{-1, 0, 10001} {
		_, err := model.SaveReferralRebatePolicy(true, rate, inviter.Id)
		assert.Error(t, err)
	}
}

func TestReferralRebateConcurrentPaymentsHaveContinuousBalanceSnapshots(t *testing.T) {
	db, inviter, payer := rebateTestDB(t)
	_, err := model.SaveReferralRebatePolicy(true, 500, inviter.Id)
	require.NoError(t, err)
	orders := make([]model.TopUp, 4)
	for i := range orders {
		orders[i] = rebateOrder(t, db, payer.Id, fmt.Sprintf("parallel-%d", i), "100")
	}
	sqlDB, err := db.DB()
	require.NoError(t, err)
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		sqlDB.SetMaxOpenConns(1)
	} else {
		sqlDB.SetMaxOpenConns(4)
	}
	callbacks := append(orders, orders[0])
	results := make(chan error, len(callbacks))
	var workers sync.WaitGroup
	for _, order := range callbacks {
		workers.Go(func() { _, err := model.RechargeEpay(order.TradeNo, "alipay", ""); results <- err })
	}
	workers.Wait()
	close(results)
	for err := range results {
		require.NoError(t, err)
	}
	var entries []model.ReferralRebate
	require.NoError(t, db.Order("balance_after").Find(&entries).Error)
	require.Len(t, entries, 4)
	for i, entry := range entries {
		require.NotNil(t, entry.BalanceBefore)
		require.NotNil(t, entry.BalanceAfter)
		assert.Equal(t, 10000000+i*2500000, *entry.BalanceBefore)
		assert.Equal(t, 12500000+i*2500000, *entry.BalanceAfter)
	}
	require.NoError(t, db.First(&inviter, inviter.Id).Error)
	assert.Equal(t, 20000000, inviter.Quota)
}

func TestReferralRebateAPIEnforcesOwnershipAndAdministratorRoles(t *testing.T) {
	db, inviter, payer := rebateTestDB(t)
	_, err := model.SaveReferralRebatePolicy(true, 500, inviter.Id)
	require.NoError(t, err)
	order := rebateOrder(t, db, payer.Id, "visible-order", "100")
	_, err = model.RechargeEpay(order.TradeNo, "alipay", "")
	require.NoError(t, err)
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/self", middleware.UserAuth(), GetSelfReferralRebates)
	router.GET("/admin", middleware.AdminAuth(), GetAdminReferralRebates)
	router.PUT("/settings", middleware.RootAuth(), SaveReferralRebateSettings)
	for _, tc := range []struct {
		name               string
		user               model.User
		method, path, body string
		status             int
		visible            bool
	}{
		{"owner ignores forged inviter", inviter, "GET", "/self?inviter_id=999", "", 200, true},
		{"payer cannot read inviter ledger", payer, "GET", "/self?inviter_id=" + fmt.Sprint(inviter.Id), "", 200, false},
		{"user cannot read admin ledger", inviter, "GET", "/admin", "", 403, false},
		{"user cannot change rate", inviter, "PUT", "/settings", `{"enabled":true,"rate_bps":10000}`, 403, false},
		{"invalid date", inviter, "GET", "/self?start_date=2026-13-01", "", 200, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			require.NoError(t, model.PublishUserAuthCache(tc.user.Id))
			bundle, err := service.CreateLoginSession(tc.user.Id, "password", "127.0.0.1", "rebate-test")
			require.NoError(t, err)
			request := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			request.Header.Set("Authorization", "Bearer "+bundle.AccessToken)
			request.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)
			assert.Equal(t, tc.status, recorder.Code)
			if tc.visible {
				assert.Contains(t, recorder.Body.String(), order.TradeNo)
			} else {
				assert.NotContains(t, recorder.Body.String(), order.TradeNo)
			}
		})
	}
	request := httptest.NewRequest("GET", "/self", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	assert.Equal(t, http.StatusUnauthorized, recorder.Code)
	for _, state := range []string{"expired", "revoked"} {
		t.Run(state+" session cannot read records", func(t *testing.T) {
			bundle, err := service.CreateLoginSession(inviter.Id, "password", "127.0.0.1", "rebate-test")
			require.NoError(t, err)
			if state == "revoked" {
				_, err = model.RevokeUserSession(inviter.Id, bundle.Session.SID, "test")
				require.NoError(t, err)
			} else {
				require.NoError(t, db.Model(&model.UserSession{}).Where("sid = ?", bundle.Session.SID).Update("expires_at", time.Now().Unix()-1).Error)
			}
			request := httptest.NewRequest("GET", "/self", nil)
			request.Header.Set("Authorization", "Bearer "+bundle.AccessToken)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			assert.Equal(t, http.StatusUnauthorized, response.Code)
			assert.NotContains(t, response.Body.String(), order.TradeNo)
		})
	}
	raw, _ := createScopedAccessToken(t, inviter.Id, time.Now().Unix()+3600, "wallet:read")
	request = httptest.NewRequest("GET", "/api/user/self/referral-rebates", nil)
	request.Header.Set("Authorization", "Bearer "+raw)
	router.GET("/api/user/self/referral-rebates", middleware.UserAuth(), GetSelfReferralRebates)
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	assert.Equal(t, http.StatusForbidden, recorder.Code, "a wallet access token cannot replace a login session")
	assert.NotContains(t, recorder.Body.String(), order.TradeNo)
}

func TestReferralRebatePaymentProvidersCreditOnce(t *testing.T) {
	for _, provider := range []string{model.PaymentProviderStripe, model.PaymentProviderCreem, model.PaymentProviderWaffo, model.PaymentProviderWaffoPancake} {
		t.Run(provider, func(t *testing.T) {
			db, inviter, payer := rebateTestDB(t)
			_, err := model.SaveReferralRebatePolicy(true, 500, inviter.Id)
			require.NoError(t, err)
			order := rebateOrder(t, db, payer.Id, "provider-"+provider, "100")
			require.NoError(t, db.Model(&order).Updates(map[string]any{"payment_provider": provider, "payment_method": provider}).Error)
			receipt := model.PaymentReceipt{Money: "80", Currency: "CNY"}
			for range 2 {
				switch provider {
				case model.PaymentProviderStripe:
					err = model.Recharge(order.TradeNo, "", "", receipt)
				case model.PaymentProviderCreem:
					err = model.RechargeCreem(order.TradeNo, "", "", "", receipt)
				case model.PaymentProviderWaffo:
					err = model.RechargeWaffo(order.TradeNo, "", receipt)
				case model.PaymentProviderWaffoPancake:
					err = model.RechargeWaffoPancake(order.TradeNo, receipt)
				}
				require.NoError(t, err)
			}
			entries, total, err := model.ListReferralRebates(model.ReferralRebateFilter{InviterID: inviter.Id}, &common.PageInfo{Page: 1, PageSize: 20})
			require.NoError(t, err)
			require.EqualValues(t, 1, total)
			require.Len(t, entries, 1)
			assert.Equal(t, "80", entries[0].PaidMoney)
			assert.Equal(t, 2000000, entries[0].RebateQuota)
			require.NoError(t, db.First(&inviter, inviter.Id).Error)
			assert.Equal(t, 12000000, inviter.Quota)
			var topupLogs int64
			require.NoError(t, model.LOG_DB.Model(&model.Log{}).Where("user_id = ? AND type = ?", payer.Id, model.LogTypeTopup).Count(&topupLogs).Error)
			assert.EqualValues(t, 1, topupLogs, "duplicate callbacks cannot create a second recharge log")
		})
	}
}

func TestReferralRebateRedemptionRecordsEachCreditAndRetries(t *testing.T) {
	db, inviter, payer := rebateTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Redemption{}))
	_, err := model.SaveReferralRebatePolicy(true, 500, inviter.Id)
	require.NoError(t, err)
	first := model.Redemption{Key: "10000000000000000000000000000001", Name: "first", Quota: 50000000, Status: common.RedemptionCodeStatusEnabled}
	second := model.Redemption{Key: "10000000000000000000000000000002", Name: "second", Quota: 100000000, Status: common.RedemptionCodeStatusEnabled}
	require.NoError(t, db.Create(&first).Error)
	require.NoError(t, db.Create(&second).Error)
	amount, err := model.Redeem(first.Key, payer.Id)
	require.NoError(t, err)
	assert.Equal(t, first.Quota, amount)
	_, err = model.Redeem(first.Key, payer.Id)
	assert.Error(t, err)
	_, err = model.SaveReferralRebatePolicy(true, 1000, inviter.Id)
	require.NoError(t, err)
	require.NoError(t, db.Model(&inviter).Update("quota", common.MaxWalletQuota).Error)
	_, err = model.Redeem(second.Key, payer.Id)
	require.NoError(t, err, "full inviter wallet must not block redemption")
	entries, total, err := model.ListReferralRebates(model.ReferralRebateFilter{InviterID: inviter.Id}, &common.PageInfo{Page: 1, PageSize: 20})
	require.NoError(t, err)
	require.EqualValues(t, 2, total)
	require.Len(t, entries, 2)
	assert.Equal(t, "pending", entries[0].Status)
	assert.Nil(t, entries[0].BalanceBefore)
	assert.Equal(t, 10000000, entries[0].RebateQuota)
	assert.Equal(t, "credited", entries[1].Status)
	assert.Equal(t, 500, entries[1].RateBPS)
	assert.Equal(t, 2500000, entries[1].RebateQuota)
	require.NotNil(t, entries[1].BalanceBefore)
	require.NotNil(t, entries[1].BalanceAfter)
	assert.Equal(t, 10000000, *entries[1].BalanceBefore)
	assert.Equal(t, 12500000, *entries[1].BalanceAfter)
	assert.Equal(t, "50000000", entries[1].PaidMoney)
	assert.Equal(t, "QTA", entries[1].Currency)
	assert.Equal(t, fmt.Sprintf("redemption:%d", first.Id), entries[1].TradeNo)
	serialized, err := common.Marshal(entries)
	require.NoError(t, err)
	assert.NotContains(t, string(serialized), first.Key, "never disclose redeemable secrets")
	require.NoError(t, db.First(&payer, payer.Id).Error)
	assert.Equal(t, 150000000, payer.Quota)
	require.NoError(t, db.Model(&inviter).Update("quota", 12500000).Error)
	model.RetryPendingReferralRebates()
	model.RetryPendingReferralRebates()
	require.NoError(t, db.First(&inviter, inviter.Id).Error)
	assert.Equal(t, 22500000, inviter.Quota)
	require.NoError(t, db.First(&entries[0], entries[0].ID).Error)
	require.NotNil(t, entries[0].BalanceBefore)
	require.NotNil(t, entries[0].BalanceAfter)
	assert.Equal(t, 12500000, *entries[0].BalanceBefore)
	assert.Equal(t, 22500000, *entries[0].BalanceAfter)
	daily, totalDays, _, err := model.GetReferralRebateDaily(model.ReferralRebateFilter{InviterID: inviter.Id}, &common.PageInfo{Page: 1, PageSize: 20})
	require.NoError(t, err)
	require.Equal(t, 1, totalDays)
	assert.Equal(t, "QTA", daily[0].Currency)
	assert.Equal(t, "150000000", daily[0].PaidMoney)
	assert.Equal(t, "12500000", daily[0].RebateQuota)
	require.NoError(t, model.ReverseReferralRebate(entries[1].ID, inviter.Id, "兑换码退款"))
	require.NoError(t, db.First(&inviter, inviter.Id).Error)
	assert.Equal(t, 20000000, inviter.Quota)
}

func TestReferralRebateRedemptionFailuresAndConcurrency(t *testing.T) {
	for _, tc := range []struct {
		name       string
		enabled    bool
		status     int
		expires    int64
		quota      int
		balance    int
		wantError  bool
		wantStatus string
	}{
		{name: "disabled policy", status: common.RedemptionCodeStatusEnabled, quota: 100, wantStatus: "disabled"},
		{name: "expired", enabled: true, status: common.RedemptionCodeStatusEnabled, expires: 1, quota: 100, wantError: true},
		{name: "used", enabled: true, status: common.RedemptionCodeStatusUsed, quota: 100, wantError: true},
		{name: "disabled code", enabled: true, status: common.RedemptionCodeStatusDisabled, quota: 100, wantError: true},
		{name: "payer overflow", enabled: true, status: common.RedemptionCodeStatusEnabled, quota: 100, balance: common.MaxWalletQuota, wantError: true},
		{name: "invalid quota", enabled: true, status: common.RedemptionCodeStatusEnabled, quota: -1, wantError: true},
		{name: "fraction truncated", enabled: true, status: common.RedemptionCodeStatusEnabled, quota: 19, wantStatus: "zero"},
		{name: "concurrent redemption", enabled: true, status: common.RedemptionCodeStatusEnabled, quota: 50000000, wantStatus: "credited"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, inviter, payer := rebateTestDB(t)
			require.NoError(t, db.AutoMigrate(&model.Redemption{}))
			_, err := model.SaveReferralRebatePolicy(tc.enabled, 500, inviter.Id)
			require.NoError(t, err)
			require.NoError(t, db.Model(&payer).Update("quota", tc.balance).Error)
			code := model.Redemption{Key: "20000000000000000000000000000001", Quota: tc.quota, Status: tc.status, ExpiredTime: tc.expires}
			require.NoError(t, db.Create(&code).Error)
			count := 1
			if tc.name == "concurrent redemption" {
				count = 4
			}
			sqlDB, err := db.DB()
			require.NoError(t, err)
			if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
				sqlDB.SetMaxOpenConns(1)
			} else {
				sqlDB.SetMaxOpenConns(4)
			}
			results := make(chan error, count)
			var workers sync.WaitGroup
			for range count {
				workers.Go(func() { _, err := model.Redeem(code.Key, payer.Id); results <- err })
			}
			workers.Wait()
			close(results)
			successes := 0
			for err := range results {
				if err == nil {
					successes++
				}
			}
			if tc.wantError {
				assert.Zero(t, successes)
			} else {
				assert.Equal(t, 1, successes)
			}
			entries, total, err := model.ListReferralRebates(model.ReferralRebateFilter{InviterID: inviter.Id}, &common.PageInfo{Page: 1, PageSize: 20})
			require.NoError(t, err)
			require.NoError(t, db.First(&payer, payer.Id).Error)
			require.NoError(t, db.First(&inviter, inviter.Id).Error)
			if tc.wantError {
				assert.Zero(t, total)
				assert.Equal(t, tc.balance, payer.Quota)
				assert.Equal(t, 10000000, inviter.Quota)
				require.NoError(t, db.First(&code, code.Id).Error)
				assert.Equal(t, tc.status, code.Status, "failed credit rolls back code consumption")
			} else {
				require.Len(t, entries, 1)
				assert.Equal(t, tc.wantStatus, entries[0].Status)
				assert.Equal(t, tc.balance+tc.quota, payer.Quota)
				assert.Equal(t, 10000000+entries[0].RebateQuota, inviter.Quota)
			}
		})
	}
}

func TestReferralRebateRedemptionLedgerFailureRollsBackCredit(t *testing.T) {
	db, inviter, payer := rebateTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Redemption{}))
	_, err := model.SaveReferralRebatePolicy(true, 500, inviter.Id)
	require.NoError(t, err)
	code := model.Redemption{Key: "30000000000000000000000000000001", Quota: 10000000, Status: common.RedemptionCodeStatusEnabled}
	require.NoError(t, db.Create(&code).Error)
	require.NoError(t, db.Migrator().DropTable(&model.ReferralRebate{}))
	_, err = model.Redeem(code.Key, payer.Id)
	require.Error(t, err)
	require.NoError(t, db.First(&payer, payer.Id).Error)
	assert.Zero(t, payer.Quota)
	require.NoError(t, db.First(&code, code.Id).Error)
	assert.Equal(t, common.RedemptionCodeStatusEnabled, code.Status)
	assert.Zero(t, code.UsedUserId)
	assert.Zero(t, code.RedeemedTime)
	require.NoError(t, db.AutoMigrate(&model.ReferralRebate{}))
	_, err = model.Redeem(code.Key, payer.Id)
	require.NoError(t, err)
	require.NoError(t, db.First(&inviter, inviter.Id).Error)
	assert.Equal(t, 10500000, inviter.Quota)
}
