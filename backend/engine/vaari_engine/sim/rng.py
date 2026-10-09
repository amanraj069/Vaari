"""A small deterministic random number generator (SplitMix64).

Why it exists: "same seed, same file" must hold on any machine and any Python version. Python's
`random.Random` is deterministic, but its sampling methods have changed between versions; this
generator is twelve lines of fixed arithmetic, so a seed always yields the same season.
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from typing import TypeVar

MASK_64 = (1 << 64) - 1
Item = TypeVar("Item")


def derive_seed(*parts: object) -> int:
    """A 64-bit seed from labelled parts (run seed, scenario, run index), stable everywhere."""
    digest = hashlib.sha256("|".join(str(part) for part in parts).encode()).digest()
    return int.from_bytes(digest[:8], "big")


class SplitMix64:
    def __init__(self, seed: int) -> None:
        self.state = seed & MASK_64

    def next_u64(self) -> int:
        self.state = (self.state + 0x9E3779B97F4A7C15) & MASK_64
        mixed = self.state
        mixed = ((mixed ^ (mixed >> 30)) * 0xBF58476D1CE4E5B9) & MASK_64
        mixed = ((mixed ^ (mixed >> 27)) * 0x94D049BB133111EB) & MASK_64
        return mixed ^ (mixed >> 31)

    def random(self) -> float:
        """Uniform in [0, 1), 53 bits."""
        return (self.next_u64() >> 11) / (1 << 53)

    def uniform(self, low: float, high: float) -> float:
        return low + (high - low) * self.random()

    def randint(self, low: int, high: int) -> int:
        """Uniform integer in [low, high] (the modulo bias over 2^64 is negligible here)."""
        return low + self.next_u64() % (high - low + 1)

    def choice(self, items: Sequence[Item]) -> Item:
        return items[self.randint(0, len(items) - 1)]
