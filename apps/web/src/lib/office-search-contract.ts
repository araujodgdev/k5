export type OfficeSearchHit =
  | { kind:'client'|'associate'|'case'|'task'; id:string; label:string; href:string }
  | { kind:'document'; documentKind:'file'|'page'|'draft'; id:string; label:string; href:string };
