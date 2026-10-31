package service

import (
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/bytedance/gopkg/util/gopool"
)

var referralRebateWorkerOnce sync.Once

func StartReferralRebateWorker() {
	referralRebateWorkerOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			ticker := time.NewTicker(time.Minute)
			defer ticker.Stop()
			model.RetryPendingReferralRebates()
			for range ticker.C {
				model.RetryPendingReferralRebates()
			}
		})
	})
}
