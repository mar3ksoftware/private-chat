import type { GroupId, KickTallyPayload } from './types';
import { CONSTANTS } from './types';

type ActiveVote = {
  readonly groupId: GroupId;
  readonly target: string;
  readonly voters: string[];
  readonly required: number;
  readonly expiresAt: number;
  timer: ReturnType<typeof setTimeout> | undefined;
};

function toTally(vote: ActiveVote): KickTallyPayload {
  return {
    groupId: vote.groupId,
    username: vote.target,
    votes: [...vote.voters],
    required: vote.required,
    status: 'active',
    expiresAt: vote.expiresAt,
  };
}

// One active kick vote per group. `required` and `expiresAt` are frozen when
// the vote opens; later membership changes never recompute them.
export class KickVoteStore {
  readonly #votes: Map<GroupId, ActiveVote>;
  readonly #ttlMs: number;
  readonly #getNow: () => number;
  onExpired: ((groupId: GroupId, target: string, tally: KickTallyPayload) => void) | undefined;

  constructor(ttlMs: number = CONSTANTS.KICK_VOTE_TTL_MS, getNow: () => number = Date.now) {
    this.#votes = new Map();
    this.#ttlMs = ttlMs;
    this.#getNow = getNow;
    this.onExpired = undefined;
  }

  start(
    groupId: GroupId,
    target: string,
    memberCount: number,
    firstVoter: string,
  ): KickTallyPayload {
    // Defensive: replacing an existing vote must not leave its timer armed.
    this.cancel(groupId);

    const vote: ActiveVote = {
      groupId,
      target,
      voters: [firstVoter],
      required: Math.floor(memberCount / 2) + 1,
      expiresAt: this.#getNow() + this.#ttlMs,
      timer: undefined,
    };
    vote.timer = setTimeout(() => {
      this.#votes.delete(groupId);
      this.onExpired?.(groupId, target, toTally(vote));
    }, this.#ttlMs);
    this.#votes.set(groupId, vote);
    return toTally(vote);
  }

  getTally(groupId: GroupId): KickTallyPayload | undefined {
    const vote = this.#votes.get(groupId);
    return vote === undefined ? undefined : toTally(vote);
  }

  addVoter(groupId: GroupId, voter: string): KickTallyPayload | undefined {
    const vote = this.#votes.get(groupId);
    if (vote === undefined) {
      return undefined;
    }
    vote.voters.push(voter);
    return toTally(vote);
  }

  dropVoter(groupId: GroupId, voter: string): boolean {
    const vote = this.#votes.get(groupId);
    if (vote === undefined) {
      return false;
    }
    const index = vote.voters.indexOf(voter);
    if (index === -1) {
      return false;
    }
    vote.voters.splice(index, 1);
    return true;
  }

  cancel(groupId: GroupId): boolean {
    const vote = this.#votes.get(groupId);
    if (vote === undefined) {
      return false;
    }
    if (vote.timer !== undefined) {
      clearTimeout(vote.timer);
    }
    this.#votes.delete(groupId);
    return true;
  }

  activeTallies(): KickTallyPayload[] {
    return [...this.#votes.values()].map(toTally);
  }

  destroy(): void {
    for (const vote of this.#votes.values()) {
      if (vote.timer !== undefined) {
        clearTimeout(vote.timer);
      }
    }
    this.#votes.clear();
    this.onExpired = undefined;
  }
}
