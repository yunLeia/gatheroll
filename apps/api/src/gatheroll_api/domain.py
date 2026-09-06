from enum import StrEnum


class JoinPolicy(StrEnum):
    OPEN = "open"
    APPROVAL_REQUIRED = "approval_required"


class ParticipantStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
