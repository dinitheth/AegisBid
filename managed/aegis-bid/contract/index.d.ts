import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum TenderMode { HighestBid = 0, LowestCompliant = 1 }

export enum TenderPhase { Open = 0, Evaluating = 1, Settled = 2, Cancelled = 3 }

export type TenderConfig = { issuer: Uint8Array;
                             deadline: bigint;
                             reserve: bigint;
                             mode: TenderMode;
                             specificationRoot: Uint8Array
                           };

export type SettlementReceipt = { winnerCommitment: Uint8Array;
                                  winningValue: bigint;
                                  comparisonRoot: Uint8Array;
                                  settledAt: bigint
                                };

export type Witnesses<PS> = {
  localBidAmount(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  localBidSalt(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  localIdentitySecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  settlementBid(context: __compactRuntime.WitnessContext<Ledger, PS>,
                index_0: bigint): [PS, bigint];
  settlementSalt(context: __compactRuntime.WitnessContext<Ledger, PS>,
                 index_0: bigint): [PS, Uint8Array];
  settlementKey(context: __compactRuntime.WitnessContext<Ledger, PS>,
                index_0: bigint): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  submitBid(context: __compactRuntime.CircuitContext<PS>,
            bidderPublicKey_0: Uint8Array,
            now_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  beginEvaluation(context: __compactRuntime.CircuitContext<PS>, now_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  settle(context: __compactRuntime.CircuitContext<PS>,
         winningIndex_0: bigint,
         bidCount_0: bigint,
         now_0: bigint): __compactRuntime.CircuitResults<PS, SettlementReceipt>;
}

export type ProvableCircuits<PS> = {
  submitBid(context: __compactRuntime.CircuitContext<PS>,
            bidderPublicKey_0: Uint8Array,
            now_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  beginEvaluation(context: __compactRuntime.CircuitContext<PS>, now_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  settle(context: __compactRuntime.CircuitContext<PS>,
         winningIndex_0: bigint,
         bidCount_0: bigint,
         now_0: bigint): __compactRuntime.CircuitResults<PS, SettlementReceipt>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  submitBid(context: __compactRuntime.CircuitContext<PS>,
            bidderPublicKey_0: Uint8Array,
            now_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  beginEvaluation(context: __compactRuntime.CircuitContext<PS>, now_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  settle(context: __compactRuntime.CircuitContext<PS>,
         winningIndex_0: bigint,
         bidCount_0: bigint,
         now_0: bigint): __compactRuntime.CircuitResults<PS, SettlementReceipt>;
}

export type Ledger = {
  readonly tender: TenderConfig;
  readonly phase: TenderPhase;
  readonly commitmentCount: bigint;
  commitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<[Uint8Array, boolean]>
  };
  nullifiers: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  readonly settlement: { is_some: boolean, value: SettlementReceipt };
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               config_0: TenderConfig): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
