package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func GetChannelStatus(c *gin.Context) {
	snapshot, err := service.GetChannelStatus(c.Request.Context())
	c.Header("Cache-Control", "no-store")
	if err != nil {
		// Do not expose management endpoints, credentials or upstream error messages.
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "Channel status is temporarily unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": snapshot})
}
