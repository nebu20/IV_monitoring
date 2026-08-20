"""SQLAlchemy ORM models for IV monitoring system."""

from datetime import datetime
from sqlalchemy import (
    Column, String, Float, Integer, DateTime, Text, ForeignKey, Boolean
)
from sqlalchemy.orm import relationship
from app.database import Base


class IVMetadata(Base):
    """Registered IV lines with patient/room/sensor binding."""
    __tablename__ = "iv_metadata"

    id = Column(Integer, primary_key=True, autoincrement=True)
    patient_id = Column(String(64), nullable=False, index=True)
    patient_name = Column(String(128), nullable=False)
    room_bed = Column(String(32), nullable=False)          # e.g. "3A-02"
    iv_id = Column(String(64), unique=True, nullable=False)
    fluid_name = Column(String(128), nullable=False)       # e.g. "NS 0.9%"
    bag_size_ml = Column(Float, nullable=False)            # e.g. 1000.0
    prescribed_rate_gtt_min = Column(Float, nullable=False)
    sensor_id = Column(String(64), unique=True, nullable=False, index=True)
    active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    telemetry = relationship("TelemetryLog", back_populates="iv", cascade="all, delete-orphan")
    events = relationship("IVEvent", back_populates="iv", cascade="all, delete-orphan")


class TelemetryLog(Base):
    """Time-series log of every processed sensor reading."""
    __tablename__ = "telemetry_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, nullable=False, index=True)
    sensor_id = Column(String(64), ForeignKey("iv_metadata.sensor_id"), nullable=False)
    raw_weight_grams = Column(Float, nullable=False)
    raw_drip_count = Column(Integer, nullable=False)
    volume_ml = Column(Float, nullable=False)
    percentage = Column(Float, nullable=False)
    drip_rate_gtt_min = Column(Float, nullable=False)
    flow_status = Column(String(32), nullable=False)   # NORMAL | ADVISORY | CRITICAL | HIGH_PRIORITY | ANOMALY
    alarm_priority = Column(String(32), nullable=False) # NORMAL | LOW | HIGH | CRITICAL
    eta_string = Column(String(32), nullable=True)
    alarm_acknowledged = Column(Boolean, default=False)

    iv = relationship("IVMetadata", back_populates="telemetry")


class IVEvent(Base):
    """Audit log of nurse-initiated events."""
    __tablename__ = "iv_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    event_type = Column(String(64), nullable=False)  # BAG_REPLACEMENT | ALERT_ACKNOWLEDGED | REGISTERED
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    iv_id = Column(String(64), ForeignKey("iv_metadata.iv_id"), nullable=False)
    nurse_notes = Column(Text, nullable=True)

    iv = relationship("IVMetadata", back_populates="events")
