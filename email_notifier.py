"""Email-to-SMS notifier with simple batching for CAIMEO."""
import os
import smtplib
import time
from email.message import EmailMessage
from pathlib import Path
from typing import List, Optional
import json

BASE_DIR = Path(__file__).resolve().parent
SMS_CONFIG_PATH = BASE_DIR / "sms_config.json"
ALERT_SMTP_HOST = os.getenv("ALERT_SMTP_HOST")
ALERT_SMTP_PORT = int(os.getenv("ALERT_SMTP_PORT", "587"))
ALERT_SMTP_USER = os.getenv("ALERT_SMTP_USER")
ALERT_SMTP_PASS = os.getenv("ALERT_SMTP_PASS")

_ALERT_QUEUE: List[str] = []
_LAST_SEND_TS: Optional[float] = None
DIGEST_SECONDS = 1800
MAX_BODY_CHARS = 480


def _load_sms_email() -> Optional[str]:
    try:
        if SMS_CONFIG_PATH.exists():
            with SMS_CONFIG_PATH.open("r") as f:
                data = json.load(f)
                sms_email = data.get("sms_email")
                if sms_email:
                    return str(sms_email)
    except Exception as e:
        print(f"⚠️ Failed to read sms_config.json: {e}")
    fallback = os.getenv("ALERT_SMS_EMAIL")
    if fallback:
        return fallback
    return None


def _send_email(lines: List[str]) -> None:
    sms_email = _load_sms_email()
    if not sms_email:
        print("ℹ️ SMS email not configured; skipping send.")
        return
    if not (ALERT_SMTP_HOST and ALERT_SMTP_USER and ALERT_SMTP_PASS):
        print("ℹ️ SMTP credentials missing; skipping SMS send.")
        return

    body = "CAIMEO updates (last 30 min):\n" + "\n".join(f"- {line}" for line in lines)
    if len(body) > MAX_BODY_CHARS:
        body = body[: MAX_BODY_CHARS - 3] + "..."

    msg = EmailMessage()
    msg["Subject"] = "CAIMEO Updates"
    msg["From"] = ALERT_SMTP_USER
    msg["To"] = sms_email
    msg.set_content(body)

    try:
        with smtplib.SMTP(ALERT_SMTP_HOST, ALERT_SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(ALERT_SMTP_USER, ALERT_SMTP_PASS)
            server.send_message(msg)
        print(f"📨 Sent SMS digest to {sms_email} with {len(lines)} line(s).")
    except Exception as e:
        print(f"⚠️ SMS email send failed: {e}")


def _enqueue(line: str) -> None:
    global _LAST_SEND_TS
    now = time.time()
    _ALERT_QUEUE.append(line)
    should_send = _LAST_SEND_TS is None or (now - _LAST_SEND_TS) >= DIGEST_SECONDS
    if should_send and _ALERT_QUEUE:
        _send_email(_ALERT_QUEUE[:])
        _ALERT_QUEUE.clear()
        _LAST_SEND_TS = now


def send_trade_alert(body: str) -> None:
    _enqueue(f"TRADE: {body}")


def send_order_alert(body: str) -> None:
    _enqueue(f"ORDER: {body}")


def send_position_alert(body: str) -> None:
    _enqueue(f"POSITION: {body}")
