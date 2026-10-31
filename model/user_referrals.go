package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
)

// InvitedUser exposes only the public profile fields needed by the inviter.
type InvitedUser struct {
	Id          int    `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	CreatedAt   int64  `json:"created_at"`
}

func GetInvitedUsers(inviterID int, page *common.PageInfo) ([]InvitedUser, int64, error) {
	if inviterID <= 0 {
		return nil, 0, errors.New("invalid inviter identity")
	}
	query := DB.Model(&User{}).Where("inviter_id = ?", inviterID)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	users := make([]InvitedUser, 0)
	err := query.Select("id", "username", "display_name", "created_at").
		Order("id DESC").Offset(page.GetStartIdx()).Limit(page.GetPageSize()).Find(&users).Error
	return users, total, err
}
