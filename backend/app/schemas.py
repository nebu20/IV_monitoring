"""Pydantic schemas for request/response validation."""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


# ── Inbound ──────────────────────────────────────────────────────────────────

class SensorPayload(BaseModel):
    """Raw payload sent by the ESP32 over HTTP POST."""
    sensorId: str = Field(..., example="SENS-104")
    weightGrams: float = Field(..., ge=0, example=250.0)
    rawDripCount: int = Field(..., ge=0, example=1420)
    timestamp: int = Field(..., description="Unix epoch seconds", example=1776510000)


class IVRegisterRequest(BaseModel):
    patient_id: str = Field(..., example="PAT-001")
    patient_name: str = Field(..., example="Abebe Girma")
    room_bed: str = Field(..., example="3A-02")
    iv_id: str = Field(..., example="IV-2024-001")
    fluid_name: str = Field(..., example="NS 0.9%")
    bag_size_ml: float = Field(..., gt=0, example=1000.0)
    prescribed_rate_gtt_min: float = Field(..., gt=0, example=30.0)
    sensor_id: str = Field(..., example="SENS-104")


class AcknowledgeRequest(BaseModel):
    iv_id: str
    nurse_notes: Optional[str] = None


class NewBagRequest(BaseModel):
    iv_id: str
    new_bag_size_ml: float = Field(..., gt=0)
    nurse_notes: Optional[str] = None


# ── Outbound ─────────────────────────────────────────────────────────────────

class TelemetryState(BaseModel):
    """Live state broadcast over WebSocket and returned by REST calls."""
    sensor_id: str
    iv_id: str
    patient_name: str
    room_bed: str
    fluid_name: str
    bag_size_ml: float
    volume_ml: float
    percentage: float
    drip_rate_gtt_min: float
    raw_weight_grams: float
    flow_status: str
    alarm_priority: str
    eta_string: str
    alarm_acknowledged: bool
    last_update: str   # ISO-8601 string
    prescribed_rate_gtt_min: float


class IVRegisterResponse(BaseModel):
    success: bool
    message: str
    iv_id: str


class AcknowledgeResponse(BaseModel):
    success: bool
    message: str


class NewBagResponse(BaseModel):
    success: bool
    message: str


class ErrorResponse(BaseModel):
    detail: str
