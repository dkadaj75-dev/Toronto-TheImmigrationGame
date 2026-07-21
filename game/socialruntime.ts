// socialruntime.ts — thin shared runtime owner for social persistence (SOCIAL S4).
// S4 interactions and the future S5 phone tab share this single container instead of each
// constructing their own relationship/cooldown state. Pure and headless: main.ts owns wiring.

import {
  PhoneState,
  RelationshipState,
  type PhoneSaveState,
  type RelationshipSaveState,
  type SocialData,
} from './social';
import { ContactBook, type ContactBookSaveState } from './contacts';

export interface SocialRuntimeSaveState {
  relationships: RelationshipSaveState;
  phone: PhoneSaveState;
  /** Newnew.txt: absent in old saves, which restore with an empty phone book. */
  contacts?: ContactBookSaveState;
}

export class SocialRuntime {
  readonly relationships: RelationshipState;
  readonly phone: PhoneState;
  readonly contacts = new ContactBook();

  constructor(data: SocialData) {
    this.relationships = new RelationshipState(data);
    this.phone = new PhoneState(data);
  }

  retune(data: SocialData): void {
    this.relationships.retune(data);
    this.phone.retune(data);
  }

  decay(simDays: number): void { this.relationships.decay(simDays); }

  serialize(): SocialRuntimeSaveState {
    return { relationships: this.relationships.serialize(), phone: this.phone.serialize(), contacts: this.contacts.serialize() };
  }

  restore(saved: SocialRuntimeSaveState): void {
    this.relationships.restore(saved.relationships);
    this.phone.restore(saved.phone);
    this.contacts.restore(saved.contacts);
  }
}
