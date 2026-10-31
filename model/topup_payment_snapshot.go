package model

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
)

type PaymentReceipt struct{ Money, Currency string }

// PaymentReceiptFromMinor is for signed provider receipts in minor currency
// units. It never treats a missing or malformed amount as an actual zero.
func PaymentReceiptFromMinor(amount, currency string) PaymentReceipt {
	currency = strings.ToUpper(currency)
	receipt := PaymentReceipt{Currency: currency}
	if len(amount) > 64 {
		return receipt
	}
	money, err := decimal.NewFromString(amount)
	if err != nil || money.IsNegative() || !money.Equal(money.Truncate(0)) {
		return receipt
	}
	digits := int32(2)
	switch currency {
	case "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF":
		digits = 0
	case "BHD", "JOD", "KWD", "OMR", "TND":
		digits = 3
	}
	receipt.Money = money.Shift(-digits).String()
	return receipt
}

// SnapshotPayment captures the price of one wallet unit in the payment
// currency, independently of group discounts and any credited gift quota.
func (topUp *TopUp) SnapshotPayment(currency string, paid, unitPrice decimal.Decimal) {
	topUp.PaidMoney = paid.String()
	topUp.PaymentCurrency = strings.ToUpper(currency)
	topUp.PaymentUnitPrice = unitPrice.String()
	topUp.PaymentQuotaPerUnit = decimal.NewFromFloat(common.QuotaPerUnit).String()
}

func (topUp *TopUp) applyPaymentReceipt(receipts []PaymentReceipt) {
	if len(receipts) == 0 {
		return
	}
	receipt := receipts[0]
	receipt.Currency = strings.ToUpper(receipt.Currency)
	// An unexpected currency cannot reuse the exchange snapshot of another one.
	if topUp.PaymentCurrency != "" && topUp.PaymentCurrency != receipt.Currency {
		topUp.PaymentUnitPrice = ""
	}
	topUp.PaymentCurrency = receipt.Currency
	topUp.PaidMoney = ""
	if len(receipt.Money) > 64 || len(receipt.Currency) != 3 {
		return
	}
	for _, letter := range receipt.Currency {
		if letter < 'A' || letter > 'Z' {
			return
		}
	}
	money, err := decimal.NewFromString(receipt.Money)
	if err == nil && !money.IsNegative() && len(money.String()) <= 64 {
		topUp.PaidMoney = money.String()
	}
}
