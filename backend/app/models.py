"""SQLAlchemy ORM models for IV monitoring system."""

from datetime import datetime
from sqlalchemy import (
    Column, String, Float, Integer, DateTime, Text,
    ForeignKey, Boolean, JSON
)
from sqlalchemy.orm import relationship
from app.database import Base


class User(Base):
    """Nurse / Admin / Superadmin accounts."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    password_hash = Column(String(256), nullable=False)
    role = Column(String(16), nullable=False, default="Nurse")
    full_name = Column(String(128), nullable=False)          # REQUIRED
    staff_id = Column(String(64), nullable=False, index=True) # REQUIRED
    license_id = Column(String(64), nullable=True)           # RN / license badge for nurses
    assigned_ward = Column(String(32), nullable=True)
    assigned_beds = Column(JSON, default=list)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class HRStaffRecord(Base):
    """
    Mock HR / Staff Room database.
    In production this would be an external HIS lookup.
    Populated via POST /api/staff (admin or Postman).
    """
    __tablename__ = "hr_staff"

    staff_id = Column(String(64), primary_key=True)
    full_name = Column(String(128), nullable=False)
    department = Column(String(64), nullable=True)     # e.g. "Ward 2A"
    ward = Column(String(32), nullable=True)           # e.g. "2A"
    license_id = Column(String(64), nullable=True)     # e.g. "RN-88492"
    license_status = Column(String(16), default="ACTIVE")  # "ACTIVE" | "REVOKED" | "EXPIRED"
    role_title = Column(String(64), nullable=True)     # e.g. "Registered Nurse"
    created_at = Column(DateTime, default=datetime.utcnow)


class CardRoomPatient(Base):
    """
    Pre-registered patient records from the hospital Card Room.
    Primary key is the Card ID / MRN issued at admission.
    """
    __tablename__ = "card_room_patients"

    card_id = Column(String(64), primary_key=True)     # MRN / Card ID
    patient_name = Column(String(128), nullable=False)
    age = Column(Integer, nullable=True)
    prescribed_fluid = Column(String(128), nullable=True)   # e.g. "NS 0.9%"
    target_volume_ml = Column(Float, nullable=True)
    target_drop_rate = Column(Float, nullable=True)         # drops/min
    ward = Column(String(64), nullable=True)
    attending_doctor = Column(String(128), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class IVMetadata(Base):
    """Registered IV lines with patient/room/sensor binding."""
    __tablename__ = "iv_metadata"

    id = Column(Integer, primary_key=True, autoincrement=True)
    patient_id = Column(String(64), nullable=False, index=True)
    patient_name = Column(String(128), nullable=False)
    room_bed = Column(String(32), nullable=False)
    iv_id = Column(String(64), unique=True, nullable=False)
    fluid_name = Column(String(128), nullable=False)
    bag_size_ml = Column(Float, nullable=False)
    prescribed_rate_gtt_min = Column(Float, nullable=False)
    sensor_id = Column(String(64), unique=True, nullable=False, index=True)
    card_id = Column(String(64), ForeignKey("card_room_patients.card_id"), nullable=True)
    active = Column(Boolean, default=True, nullable=False)
    bed_status = Column(String(16), default="ACTIVE", nullable=False)  # "ACTIVE" | "IDLE"
    session_start = Column(DateTime, nullable=True)
    session_end = Column(DateTime, nullable=True)
    total_volume_delivered_ml = Column(Float, nullable=True)
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
    flow_status = Column(String(32), nullable=False)
    alarm_priority = Column(String(32), nullable=False)
    eta_string = Column(String(32), nullable=True)
    alarm_acknowledged = Column(Boolean, default=False)
    # ESP32 power fields
    battery_level = Column(Integer, nullable=True)       # 0-100
    power_source = Column(String(16), nullable=True)     # "AC_GRID" | "BATTERY"
    node_status = Column(String(32), nullable=True)      # ESP32 status flag

    iv = relationship("IVMetadata", back_populates="telemetry")


class IVEvent(Base):
    """Audit log of nurse-initiated events."""
    __tablename__ = "iv_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    event_type = Column(String(64), nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    iv_id = Column(String(64), ForeignKey("iv_metadata.iv_id"), nullable=False)
    nurse_notes = Column(Text, nullable=True)
    performed_by = Column(String(64), nullable=True)

    iv = relationship("IVMetadata", back_populates="events")


class IVSessionHistory(Base):
    """Completed / released IV session archive for auditing."""
    __tablename__ = "iv_session_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    iv_id = Column(String(64), nullable=False)
    patient_name = Column(String(128), nullable=False)
    card_id = Column(String(64), nullable=True)
    room_bed = Column(String(32), nullable=False)
    fluid_name = Column(String(128), nullable=False)
    bag_size_ml = Column(Float, nullable=False)
    sensor_id = Column(String(64), nullable=False)
    session_start = Column(DateTime, nullable=True)
    session_end = Column(DateTime, nullable=True)
    total_volume_delivered_ml = Column(Float, nullable=True)
    released_by = Column(String(64), nullable=True)   # username of nurse
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
