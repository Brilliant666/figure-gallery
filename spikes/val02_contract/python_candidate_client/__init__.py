"""Candidate-only client shared by the two disposable VAL-02 prototypes."""

from .client import ADAPTERS, CandidateClient, CandidateClientError, prepare_candidate_envelope

__all__ = ["ADAPTERS", "CandidateClient", "CandidateClientError", "prepare_candidate_envelope"]
