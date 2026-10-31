package model

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ReferralRebatePolicy is stored in the primary database so all gateway
// instances use the same policy at the first successful payment settlement.
type ReferralRebatePolicy struct {
	ID        int   `json:"id" gorm:"primaryKey"`
	Enabled   bool  `json:"enabled"`
	RateBPS   int   `json:"rate_bps"`
	Version   int64 `json:"version"`
	UpdatedAt int64 `json:"updated_at"`
	UpdatedBy int   `json:"updated_by"`
}

// ReferralRebate is an immutable monetary snapshot. Only delivery status and
// delivery snapshots are filled later; policy changes never recalculate it.
type ReferralRebate struct {
	ID               int    `json:"id"`
	OrderKey         string `json:"-" gorm:"type:varchar(80);uniqueIndex"`
	TopUpID          int    `json:"-" gorm:"index"`
	TradeNo          string `json:"trade_no" gorm:"type:varchar(255)"`
	InviterID        int    `json:"inviter_id" gorm:"index:idx_rebate_owner_time,priority:1"`
	InviterName      string `json:"inviter_name" gorm:"type:varchar(64)"`
	PayerID          int    `json:"payer_id" gorm:"index"`
	PayerName        string `json:"payer_name" gorm:"type:varchar(64)"`
	PaidMoney        string `json:"paid_money" gorm:"type:varchar(64)"`
	Currency         string `json:"currency" gorm:"type:varchar(3)"`
	PaymentUnitPrice string `json:"payment_unit_price" gorm:"type:varchar(64)"`
	QuotaPerUnit     string `json:"quota_per_unit" gorm:"type:varchar(64)"`
	RateBPS          int    `json:"rate_bps"`
	PolicyVersion    int64  `json:"policy_version"`
	RebateQuota      int    `json:"rebate_quota" gorm:"type:bigint"`
	BalanceBefore    *int   `json:"balance_before" gorm:"type:bigint"`
	BalanceAfter     *int   `json:"balance_after" gorm:"type:bigint"`
	Status           string `json:"status" gorm:"type:varchar(24);index:idx_rebate_pending,priority:1"`
	Kind             string `json:"kind" gorm:"type:varchar(16)"`
	Reason           string `json:"reason" gorm:"type:varchar(255)"`
	OriginalID       int    `json:"original_id"`
	CreatedAt        int64  `json:"created_at" gorm:"index:idx_rebate_owner_time,priority:2;index:idx_rebate_pending,priority:2"`
	CreditedAt       int64  `json:"credited_at"`
	Day              string `json:"day" gorm:"type:varchar(10);index"`
	ActorID          int    `json:"actor_id"`
}

// Dates are explicitly Beijing calendar dates, independent of the host TZ.
var referralRebateZone = time.FixedZone("Asia/Shanghai", 8*60*60)

func GetReferralRebatePolicy() (ReferralRebatePolicy, error) {
	policy := ReferralRebatePolicy{ID: 1}
	err := DB.Find(&policy, 1).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return policy, nil
	}
	return policy, err
}

func SaveReferralRebatePolicy(enabled bool, rateBPS, actorID int) (ReferralRebatePolicy, error) {
	if rateBPS < 0 || rateBPS > 10000 || (enabled && rateBPS == 0) {
		return ReferralRebatePolicy{}, common.NewMessage("Rebate rate must be greater than 0% and at most 100% when enabled")
	}
	policy := ReferralRebatePolicy{ID: 1}
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&policy).Error; err != nil {
			return err
		}
		if err := lockForUpdate(tx).First(&policy, 1).Error; err != nil {
			return err
		}
		policy.Enabled, policy.RateBPS, policy.UpdatedBy = enabled, rateBPS, actorID
		policy.Version++
		policy.UpdatedAt = common.GetTimestamp()
		return tx.Save(&policy).Error
	})
	return policy, err
}

// settlePaidTopUp records the payment and potential rebate in the same primary
// DB transaction. Delivering a rebate is separate so a disabled/full inviter
// wallet never prevents the payer's successfully purchased quota from arriving.
func settlePaidTopUp(tx *gorm.DB, topUp *TopUp, creditedQuota int, updates map[string]any) error {
	if err := creditTopUpQuota(tx, topUp.UserId, creditedQuota, updates); err != nil {
		return err
	}
	return recordReferralRebate(tx, topUp.UserId, &ReferralRebate{
		OrderKey: fmt.Sprintf("topup:%d", topUp.Id), TopUpID: topUp.Id, TradeNo: topUp.TradeNo,
		PaidMoney: topUp.PaidMoney, Currency: topUp.PaymentCurrency,
		PaymentUnitPrice: topUp.PaymentUnitPrice, QuotaPerUnit: topUp.PaymentQuotaPerUnit,
		CreatedAt: topUp.CompleteTime,
	})
}

// recordReferralRebate captures the policy and creates the durable delivery
// record inside the transaction that credits the recharge. QTA denotes wallet
// quota from redemption codes, not a cash payment or a foreign currency.
func recordReferralRebate(tx *gorm.DB, payerID int, entry *ReferralRebate) error {
	var payer User
	if err := tx.Select("id", "username", "inviter_id").First(&payer, payerID).Error; err != nil {
		return err
	}
	if payer.InviterId <= 0 || payer.InviterId == payer.Id {
		return nil
	}
	var inviter User
	err := tx.Unscoped().Select("id", "username").First(&inviter, payer.InviterId).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	var policy ReferralRebatePolicy
	if err := tx.Find(&policy, 1).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	entry.InviterID, entry.InviterName = inviter.Id, inviter.Username
	entry.PayerID, entry.PayerName = payer.Id, payer.Username
	entry.RateBPS, entry.PolicyVersion = policy.RateBPS, policy.Version
	entry.Status, entry.Kind = "disabled", "rebate"
	entry.Day = time.Unix(entry.CreatedAt, 0).In(referralRebateZone).Format("2006-01-02")
	if policy.Enabled {
		entry.Status = "pending"
		money, moneyErr := decimal.NewFromString(entry.PaidMoney)
		price, priceErr := decimal.NewFromString(entry.PaymentUnitPrice)
		unit, unitErr := decimal.NewFromString(entry.QuotaPerUnit)
		switch {
		case moneyErr != nil || priceErr != nil || unitErr != nil || money.IsNegative() || !price.IsPositive() || !unit.IsPositive() || len(entry.Currency) != 3:
			entry.Status, entry.Reason = "review", "Payment conversion snapshot is unavailable"
		case policy.RateBPS <= 0 || policy.RateBPS > 10000:
			entry.Status, entry.Reason = "review", "Invalid rebate policy"
		default:
			// Floor to whole quota units. Never use floating-point multiplication or
			// silently saturate a financial credit into a different amount.
			wholeQuota, _ := money.Mul(unit).Mul(decimal.NewFromInt(int64(policy.RateBPS))).QuoRem(price.Mul(decimal.NewFromInt(10000)), 0)
			quota, err := common.WalletQuotaFromDecimalStrict(wholeQuota)
			if err != nil || quota < 0 {
				entry.Status, entry.Reason = "review", "Rebate amount exceeds the wallet limit"
			} else {
				entry.RebateQuota = quota
				if quota == 0 {
					entry.Status = "zero"
				}
			}
		}
	}
	return tx.Create(entry).Error
}

func DeliverReferralRebate(id int) error {
	var entry ReferralRebate
	delivered := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).First(&entry, id).Error; err != nil {
			return err
		}
		if entry.Status != "pending" {
			return nil
		}
		var inviter User
		err := lockForUpdate(tx).First(&inviter, entry.InviterID).Error
		if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && inviter.Status != common.UserStatusEnabled) {
			return tx.Model(&entry).Update("reason", "Recipient account is unavailable").Error
		}
		if err != nil {
			return err
		}
		if entry.RebateQuota <= 0 || inviter.Quota > common.MaxWalletQuota-entry.RebateQuota {
			return tx.Model(&entry).Update("reason", "Recipient wallet limit reached").Error
		}
		before, after := inviter.Quota, inviter.Quota+entry.RebateQuota
		if err := creditTopUpQuota(tx, inviter.Id, entry.RebateQuota, nil); err != nil {
			return err
		}
		entry.BalanceBefore, entry.BalanceAfter = &before, &after
		entry.Status, entry.Reason, entry.CreditedAt = "credited", "", common.GetTimestamp()
		entry.Day = time.Unix(entry.CreditedAt, 0).In(referralRebateZone).Format("2006-01-02")
		if err := tx.Save(&entry).Error; err != nil {
			return err
		}
		delivered = true
		return nil
	})
	if err == nil && delivered {
		syncCreditUserQuotaCache(entry.InviterID, entry.RebateQuota, "referral rebate")
	}
	return err
}

// ProcessTopUpReferralRebate is also safe after a repeated payment callback.
func ProcessTopUpReferralRebate(topUpID int) {
	var entry ReferralRebate
	err := DB.Select("id").Where("top_up_id = ? AND kind = ? AND status = ?", topUpID, "rebate", "pending").Find(&entry).Error
	if err == nil && entry.ID == 0 {
		return
	}
	if err == nil {
		err = DeliverReferralRebate(entry.ID)
	}
	if err != nil {
		common.SysError(common.LogText("referral rebate delivery failed for topup %d: %v", topUpID, err))
	}
}

func RetryPendingReferralRebates() {
	// Ordered by last attempt would let permanently blocked wallets starve new
	// entries. Scan by ID with a keyset, in bounded batches, on every pass.
	lastID := 0
	for {
		var entries []ReferralRebate
		if err := DB.Select("id").Where("status = ? AND id > ?", "pending", lastID).Order("id").Limit(100).Find(&entries).Error; err != nil {
			common.SysError(common.LogText("referral rebate retry scan failed: %v", err))
			return
		}
		if len(entries) == 0 {
			return
		}
		for _, entry := range entries {
			if err := DeliverReferralRebate(entry.ID); err != nil {
				common.SysError(common.LogText("referral rebate %d retry failed: %v", entry.ID, err))
			}
			lastID = entry.ID
		}
	}
}

func ReverseReferralRebate(id, actorID int, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" || utf8.RuneCountInString(reason) > 200 {
		return common.NewMessage("A reversal reason of at most 200 characters is required")
	}
	var reversal ReferralRebate
	changed := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		var original ReferralRebate
		if err := lockForUpdate(tx).First(&original, id).Error; err != nil {
			return err
		}
		if original.Status == "reversed" {
			return nil
		}
		if original.Kind != "rebate" || original.Status != "credited" {
			return common.NewMessage("Only credited rebates can be reversed")
		}
		var user User
		if err := lockForUpdate(tx).First(&user, original.InviterID).Error; err != nil {
			return err
		}
		if user.Quota < original.RebateQuota {
			return common.NewMessage("Insufficient balance to reverse this rebate")
		}
		before, after := user.Quota, user.Quota-original.RebateQuota
		if err := tx.Model(&User{}).Where("id = ? AND quota >= ?", user.Id, original.RebateQuota).Update("quota", gorm.Expr("quota - ?", original.RebateQuota)).Error; err != nil {
			return err
		}
		now := common.GetTimestamp()
		reversal = original
		reversal.ID = 0
		reversal.OrderKey = fmt.Sprintf("reverse:%d", original.ID)
		reversal.OriginalID, reversal.ActorID = original.ID, actorID
		reversal.RebateQuota = -original.RebateQuota
		reversal.BalanceBefore, reversal.BalanceAfter = &before, &after
		reversal.Kind, reversal.Status, reversal.Reason = "reversal", "credited", reason
		reversal.CreatedAt, reversal.CreditedAt = now, now
		reversal.Day = time.Unix(now, 0).In(referralRebateZone).Format("2006-01-02")
		if err := tx.Create(&reversal).Error; err != nil {
			return err
		}
		if err := tx.Model(&original).Update("status", "reversed").Error; err != nil {
			return err
		}
		changed = true
		return nil
	})
	if err == nil && changed {
		if err := cacheIncrUserQuota(reversal.InviterID, int64(reversal.RebateQuota)); err != nil && common.RedisEnabled {
			common.SysError(common.LogText("referral rebate reversal cache sync failed: %v", err))
		}
	}
	return err
}

type ReferralRebateFilter struct {
	InviterID, PayerID       int
	StartDay, EndDay, Status string
}

func referralRebateQuery(filter ReferralRebateFilter) *gorm.DB {
	q := DB.Model(&ReferralRebate{})
	if filter.InviterID > 0 {
		q = q.Where("inviter_id = ?", filter.InviterID)
	}
	if filter.PayerID > 0 {
		q = q.Where("payer_id = ?", filter.PayerID)
	}
	if filter.StartDay != "" {
		q = q.Where("day >= ?", filter.StartDay)
	}
	if filter.EndDay != "" {
		q = q.Where("day <= ?", filter.EndDay)
	}
	if filter.Status != "" {
		q = q.Where("status = ?", filter.Status)
	}
	return q
}

func ListReferralRebates(filter ReferralRebateFilter, page *common.PageInfo) ([]ReferralRebate, int64, error) {
	q := referralRebateQuery(filter)
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	entries := make([]ReferralRebate, 0)
	err := q.Order("id DESC").Limit(page.PageSize).Offset(page.GetStartIdx()).Find(&entries).Error
	return entries, total, err
}

type ReferralRebateDaily struct {
	Day          string `json:"day"`
	InviterID    int    `json:"inviter_id"`
	InviterName  string `json:"inviter_name"`
	Currency     string `json:"currency"`
	PaidMoney    string `json:"paid_money"`
	RebateQuota  string `json:"rebate_quota"`
	PendingQuota string `json:"pending_quota"`
	Count        int    `json:"count"`
	Recipients   int    `json:"recipients"`
}

func GetReferralRebateDaily(filter ReferralRebateFilter, page *common.PageInfo) ([]ReferralRebateDaily, int, []ReferralRebateDaily, error) {
	// Decimal accumulation preserves exact amounts across currencies and avoids
	// dialect-specific date/decimal functions and JS-unsafe aggregate integers.
	rows, err := referralRebateQuery(filter).Select("day", "inviter_id", "inviter_name", "currency", "paid_money", "rebate_quota", "status", "kind").Rows()
	if err != nil {
		return nil, 0, nil, err
	}
	defer rows.Close()
	groups := make(map[string]*ReferralRebateDaily)
	recipients := make(map[string]map[int]struct{})
	for rows.Next() {
		var entry ReferralRebate
		if err := DB.ScanRows(rows, &entry); err != nil {
			return nil, 0, nil, err
		}
		key := fmt.Sprintf("%s:%d:%s", entry.Day, entry.InviterID, entry.Currency)
		group := groups[key]
		if group == nil {
			group = &ReferralRebateDaily{Day: entry.Day, InviterID: entry.InviterID, InviterName: entry.InviterName, Currency: entry.Currency, PaidMoney: "0", RebateQuota: "0", PendingQuota: "0"}
			groups[key] = group
		}
		if entry.Kind == "rebate" {
			group.Count++
			if money, err := decimal.NewFromString(entry.PaidMoney); err == nil {
				previous, _ := decimal.NewFromString(group.PaidMoney)
				group.PaidMoney = previous.Add(money).String()
			}
		}
		if entry.Status == "credited" || entry.Status == "reversed" {
			if recipients[entry.Currency] == nil {
				recipients[entry.Currency] = make(map[int]struct{})
			}
			recipients[entry.Currency][entry.InviterID] = struct{}{}
			previous, _ := decimal.NewFromString(group.RebateQuota)
			group.RebateQuota = previous.Add(decimal.NewFromInt(int64(entry.RebateQuota))).String()
		}
		if entry.Status == "pending" {
			previous, _ := decimal.NewFromString(group.PendingQuota)
			group.PendingQuota = previous.Add(decimal.NewFromInt(int64(entry.RebateQuota))).String()
		}
	}
	if err := rows.Err(); err != nil {
		return nil, 0, nil, err
	}
	result := make([]ReferralRebateDaily, 0, len(groups))
	for _, group := range groups {
		result = append(result, *group)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Day != result[j].Day {
			return result[i].Day > result[j].Day
		}
		if result[i].InviterID != result[j].InviterID {
			return result[i].InviterID < result[j].InviterID
		}
		return result[i].Currency < result[j].Currency
	})
	total := len(result)
	start := min(page.GetStartIdx(), total)
	totals := make(map[string]*ReferralRebateDaily)
	for _, group := range result {
		total := totals[group.Currency]
		if total == nil {
			total = &ReferralRebateDaily{Currency: group.Currency, PaidMoney: "0", RebateQuota: "0", PendingQuota: "0"}
			totals[group.Currency] = total
		}
		money, _ := decimal.NewFromString(total.PaidMoney)
		added, _ := decimal.NewFromString(group.PaidMoney)
		total.PaidMoney = money.Add(added).String()
		quota, _ := decimal.NewFromString(total.RebateQuota)
		added, _ = decimal.NewFromString(group.RebateQuota)
		total.RebateQuota = quota.Add(added).String()
		pending, _ := decimal.NewFromString(total.PendingQuota)
		added, _ = decimal.NewFromString(group.PendingQuota)
		total.PendingQuota = pending.Add(added).String()
		total.Count += group.Count
	}
	summary := make([]ReferralRebateDaily, 0, len(totals))
	for _, total := range totals {
		total.Recipients = len(recipients[total.Currency])
		summary = append(summary, *total)
	}
	sort.Slice(summary, func(i, j int) bool { return summary[i].Currency < summary[j].Currency })
	return result[start:min(start+page.PageSize, total)], total, summary, nil
}
