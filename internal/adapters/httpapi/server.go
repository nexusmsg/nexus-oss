package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

type Server struct {
	echo           *echo.Echo
	messageService ports.OutboundMessageService
	phoneNumberID  string
	authToken      string
}

func NewServer(messageService ports.OutboundMessageService, phoneNumberID, authToken string) *Server {
	s := &Server{
		echo:           echo.New(),
		messageService: messageService,
		phoneNumberID:  phoneNumberID,
		authToken:      authToken,
	}
	s.echo.Use(middleware.RequestLogger(), middleware.Recover(), middleware.BodyLimit("1M"))
	s.echo.POST("/:phone_number_id/messages", s.sendMessage)
	s.echo.HTTPErrorHandler = s.handleHTTPError
	return s
}

func (s *Server) Start(address string) error {
	return s.echo.Start(address)
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.echo.Shutdown(ctx)
}

func (s *Server) sendMessage(c echo.Context) error {
	if !s.authorized(c.Request()) {
		return s.writeError(c, http.StatusUnauthorized, 190, "Invalid OAuth access token")
	}
	if c.Param("phone_number_id") != s.phoneNumberID {
		return s.writeError(c, http.StatusNotFound, 100, "Phone number ID was not found")
	}

	var request domain.OutboundMessage
	decoder := json.NewDecoder(c.Request().Body)
	if err := decoder.Decode(&request); err != nil {
		return s.writeError(c, http.StatusBadRequest, 100, "Invalid request body")
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return s.writeError(c, http.StatusBadRequest, 100, "Request body must contain one JSON value")
	}

	response, err := s.messageService.Send(c.Request().Context(), request)
	if err != nil {
		var validationErr *domain.ValidationError
		if errors.As(err, &validationErr) {
			return s.writeError(c, http.StatusBadRequest, 100, validationErr.Error())
		}
		return s.writeError(c, http.StatusServiceUnavailable, 131000, "Unable to send message")
	}
	return c.JSON(http.StatusOK, response)
}

func (s *Server) authorized(request *http.Request) bool {
	if s.authToken == "" {
		return true
	}
	const prefix = "Bearer "
	value := request.Header.Get("Authorization")
	if !strings.HasPrefix(value, prefix) {
		return false
	}
	token := strings.TrimPrefix(value, prefix)
	return subtle.ConstantTimeCompare([]byte(token), []byte(s.authToken)) == 1
}

func (s *Server) writeError(c echo.Context, status, code int, message string) error {
	return c.JSON(status, apiErrorResponse{Error: apiError{
		Message: message,
		Type:    "OAuthException",
		Code:    code,
	}})
}

func (s *Server) handleHTTPError(err error, c echo.Context) {
	if c.Response().Committed {
		return
	}
	status := http.StatusInternalServerError
	message := "Internal server error"
	var httpErr *echo.HTTPError
	if errors.As(err, &httpErr) {
		status = httpErr.Code
		message = fmt.Sprint(httpErr.Message)
	}
	_ = s.writeError(c, status, 131000, message)
}

type apiErrorResponse struct {
	Error apiError `json:"error"`
}

type apiError struct {
	Message string `json:"message"`
	Type    string `json:"type"`
	Code    int    `json:"code"`
}
