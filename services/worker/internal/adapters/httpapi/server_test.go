package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
)

type fakeMessageService struct {
	response domain.OutboundResponse
	err      error
}

func (s fakeMessageService) Send(_ context.Context, _ domain.OutboundMessage) (domain.OutboundResponse, error) {
	return s.response, s.err
}

func TestSendMessageReturnsWABAResponse(t *testing.T) {
	server := NewServer(fakeMessageService{response: domain.OutboundResponse{
		MessagingProduct: "whatsapp",
		Messages:         []domain.OutboundMessageReceipt{{ID: "wamid-123"}},
	}}, "phone-123", "secret")
	request := httptest.NewRequest(http.MethodPost, "/phone-123/messages", strings.NewReader(`{"messaging_product":"whatsapp","to":"628123456789","type":"text","text":{"body":"hello"}}`))
	request.Header.Set("Authorization", "Bearer secret")
	recorder := httptest.NewRecorder()

	server.echo.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response domain.OutboundResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Messages[0].ID != "wamid-123" {
		t.Fatalf("response = %+v", response)
	}
}

func TestSendMessageRejectsInvalidAuthorization(t *testing.T) {
	server := NewServer(fakeMessageService{}, "phone-123", "secret")
	request := httptest.NewRequest(http.MethodPost, "/phone-123/messages", strings.NewReader(`{}`))
	recorder := httptest.NewRecorder()

	server.echo.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response apiErrorResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if response.Error.Code != 190 {
		t.Fatalf("error = %+v", response.Error)
	}
}

func TestSendMessageRejectsPhoneNumberMismatch(t *testing.T) {
	server := NewServer(fakeMessageService{}, "phone-123", "")
	request := httptest.NewRequest(http.MethodPost, "/other/messages", strings.NewReader(`{}`))
	recorder := httptest.NewRecorder()

	server.echo.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d", recorder.Code)
	}
}
