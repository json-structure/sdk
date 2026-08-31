import { PROTOCOL_VERSION, type DocumentVersion, type ProtocolEnvelope } from './contracts.js';

export type CatalogFamily = 'symbol' | 'unit' | 'ucumUnit' | 'currency';
export type CatalogProviderKind = 'bundled' | 'workspace' | 'https' | 'host';
export interface CatalogProviderManifest {
  readonly id: string;
  readonly label: string;
  readonly kind: CatalogProviderKind;
  readonly families: readonly CatalogFamily[];
  readonly source: string;
  readonly version: string;
  readonly priority?: number;
  readonly trusted?: boolean;
  readonly endpoint?: string;
}
export interface CatalogEntry {
  readonly family: CatalogFamily;
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly aliases?: readonly string[];
}
export interface CatalogSearchRequest extends ProtocolEnvelope {
  readonly kind: 'catalog-search';
  readonly invocationId: string;
  readonly documentVersion: DocumentVersion;
  readonly catalogVersion: number;
  readonly family: CatalogFamily;
  readonly query: string;
  readonly limit: number;
}
export interface CatalogProviderResult extends ProtocolEnvelope {
  readonly kind: 'catalog-results';
  readonly invocationId: string;
  readonly documentVersion: DocumentVersion;
  readonly catalogVersion: number;
  readonly providerId: string;
  readonly entries: readonly CatalogEntry[];
  readonly stale?: boolean;
  readonly continuation?: string;
}
export interface CatalogProvenance {
  readonly providerId: string;
  readonly providerLabel: string;
  readonly providerKind: CatalogProviderKind;
  readonly source: string;
  readonly version: string;
  readonly stale: boolean;
  readonly trusted: boolean;
}
export interface CatalogSuggestion extends CatalogEntry {
  readonly emittedJson: string;
  readonly score: number;
  readonly advisory: true;
  readonly provenance: readonly CatalogProvenance[];
}
export type CatalogProviderIssueCode = 'provider-threw' | 'invalid-envelope' | 'request-mismatch' | 'unknown-provider' | 'unsupported-family';
export interface CatalogProviderIssue {
  readonly providerId: string;
  readonly code: CatalogProviderIssueCode;
  readonly message: string;
}
export interface CatalogProvider {
  readonly providerId: string;
  search(request: CatalogSearchRequest): unknown | Promise<unknown>;
}
export interface CatalogMergeResult extends ProtocolEnvelope {
  readonly kind: 'catalog-merge';
  readonly documentVersion: DocumentVersion;
  readonly catalogVersion: number;
  readonly cancelled: boolean;
  readonly stale: boolean;
  readonly suggestions: readonly CatalogSuggestion[];
  readonly providerIssues: readonly CatalogProviderIssue[];
}

function validManifest(manifest: CatalogProviderManifest): boolean {
  return manifest.id.trim().length > 0 && manifest.label.trim().length > 0 && manifest.source.trim().length > 0 &&
    manifest.version.trim().length > 0 && manifest.families.length > 0 && new Set(manifest.families).size === manifest.families.length &&
    (manifest.kind !== 'https' || (typeof manifest.endpoint === 'string' && /^https:\/\//.test(manifest.endpoint)));
}
function normalized(value: string): string { return value.normalize('NFKC').toLocaleLowerCase('en-US'); }
const catalogFamilies = new Set<CatalogFamily>(['symbol', 'unit', 'ucumUnit', 'currency']);
function validEntry(value: unknown): value is CatalogEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return catalogFamilies.has(entry.family as CatalogFamily) && typeof entry.value === 'string' && entry.value.length > 0 &&
    typeof entry.label === 'string' && entry.label.trim().length > 0 &&
    (entry.description === undefined || typeof entry.description === 'string') &&
    (entry.aliases === undefined || (Array.isArray(entry.aliases) && entry.aliases.every((alias) => typeof alias === 'string')));
}
function validateProviderResult(value: unknown, request: CatalogSearchRequest, expectedProviderId?: string): CatalogProviderResult | CatalogProviderIssue {
  const providerId = expectedProviderId ?? (value && typeof value === 'object' && typeof (value as Record<string, unknown>).providerId === 'string'
    ? (value as Record<string, unknown>).providerId as string : '<unknown>');
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { providerId, code: 'invalid-envelope', message: 'Provider result must be an object.' };
  const result = value as Record<string, unknown>;
  if (result.protocolVersion !== PROTOCOL_VERSION || result.kind !== 'catalog-results' || typeof result.providerId !== 'string' || !result.providerId.trim() ||
    !Number.isInteger(result.catalogVersion) || !Array.isArray(result.entries) || !result.entries.every(validEntry) ||
    typeof result.requestId !== 'string' || !result.requestId.trim() || typeof result.invocationId !== 'string' || !result.invocationId.trim() ||
    !Number.isInteger(result.documentVersion) ||
    (result.stale !== undefined && typeof result.stale !== 'boolean') ||
    (result.continuation !== undefined && typeof result.continuation !== 'string')) {
    return { providerId, code: 'invalid-envelope', message: 'Provider result envelope or entries are malformed.' };
  }
  if ((expectedProviderId !== undefined && result.providerId !== expectedProviderId) ||
    result.requestId !== request.requestId || result.invocationId !== request.invocationId ||
    result.documentVersion !== request.documentVersion || result.catalogVersion !== request.catalogVersion) {
    return { providerId, code: 'request-mismatch', message: 'Provider result does not match the catalog request.' };
  }
  return result as unknown as CatalogProviderResult;
}
function entryTieBreak(left: CatalogEntry, right: CatalogEntry): number {
  return normalized(left.label).localeCompare(normalized(right.label)) || left.label.localeCompare(right.label) ||
    (left.description ?? '').localeCompare(right.description ?? '') ||
    [...(left.aliases ?? [])].sort().join('\u0000').localeCompare([...(right.aliases ?? [])].sort().join('\u0000'));
}
function rank(entry: CatalogEntry, query: string, priority: number): number {
  const needle = normalized(query.trim());
  if (!needle) return 1000 + priority;
  const value = normalized(entry.value);
  const label = normalized(entry.label);
  const aliases = (entry.aliases ?? []).map(normalized);
  if (value === needle) return 5000 + priority;
  if (label === needle) return 4500 + priority;
  if (value.startsWith(needle)) return 4000 + priority;
  if (label.startsWith(needle)) return 3500 + priority;
  if (aliases.some((alias) => alias === needle)) return 3250 + priority;
  if (value.includes(needle) || label.includes(needle) || aliases.some((alias) => alias.includes(needle))) return 2000 + priority;
  return -1;
}

export class CatalogRegistry {
  private readonly providers = new Map<string, CatalogProviderManifest>();
  private readonly cancelled = new Set<string>();
  private readonly activeInvocations = new Map<string, Set<string>>();
  private nextInvocation = 1;
  private version = 1;

  get catalogVersion(): number { return this.version; }
  listProviders(): readonly CatalogProviderManifest[] {
    return [...this.providers.values()].sort((left, right) => left.id.localeCompare(right.id));
  }
  register(manifest: CatalogProviderManifest): number {
    if (!validManifest(manifest)) throw new Error('Catalog provider manifest is invalid.');
    this.providers.set(manifest.id, Object.freeze({ ...manifest, families: Object.freeze([...manifest.families]) }));
    return ++this.version;
  }
  unregister(providerId: string): number {
    if (this.providers.delete(providerId)) this.version++;
    return this.version;
  }
  cancel(request: CatalogSearchRequest | string): void {
    if (typeof request !== 'string') {
      this.cancelled.add(request.invocationId);
      return;
    }
    const invocations = this.activeInvocations.get(request);
    if (!invocations || invocations.size !== 1) throw new Error('Catalog request ID does not identify exactly one active invocation.');
    this.cancelled.add([...invocations][0]);
  }
  createRequest(requestId: string, documentVersion: DocumentVersion, family: CatalogFamily, query: string, limit = 50): CatalogSearchRequest {
    if (!requestId.trim() || !Number.isInteger(limit) || limit < 1) throw new Error('Catalog request is invalid.');
    const invocationId = `catalog-${this.nextInvocation++}`;
    const invocations = this.activeInvocations.get(requestId) ?? new Set<string>();
    invocations.add(invocationId);
    this.activeInvocations.set(requestId, invocations);
    return { protocolVersion: PROTOCOL_VERSION, requestId, kind: 'catalog-search', invocationId, documentVersion, catalogVersion: this.version, family, query, limit };
  }
  async search(request: CatalogSearchRequest, providers: readonly CatalogProvider[], customValues: readonly CatalogEntry[] = []): Promise<CatalogMergeResult> {
    const settled: Array<{ value: unknown; providerId: string } | { issue: CatalogProviderIssue; providerId: string }> = await Promise.all(providers.map(async ({ providerId, search }) => {
      try { return { value: await search(request), providerId }; }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { issue: { providerId, code: 'provider-threw' as const, message: `Catalog provider threw: ${message}` }, providerId };
      }
    }));
    return this.mergeInternal(request, settled.filter((item) => 'value' in item).map((item) => ({ value: item.value, expectedProviderId: item.providerId })), customValues,
      settled.filter((item) => 'issue' in item).map((item) => item.issue));
  }
  merge(request: CatalogSearchRequest, results: readonly unknown[], customValues: readonly CatalogEntry[] = []): CatalogMergeResult {
    return this.mergeInternal(request, results.map((value) => ({ value })), customValues, []);
  }
  private mergeInternal(request: CatalogSearchRequest, rawResults: readonly { value: unknown; expectedProviderId?: string }[], customValues: readonly CatalogEntry[], initialIssues: readonly CatalogProviderIssue[]): CatalogMergeResult {
    const active = this.activeInvocations.get(request.requestId);
    active?.delete(request.invocationId);
    if (active?.size === 0) this.activeInvocations.delete(request.requestId);
    const cancelled = this.cancelled.delete(request.invocationId);
    const stale = request.catalogVersion !== this.version;
    if (cancelled || stale) return { ...request, kind: 'catalog-merge', cancelled, stale, suggestions: [], providerIssues: [...initialIssues] };

    const providerIssues = [...initialIssues];
    const results: CatalogProviderResult[] = [];
    for (const rawResult of rawResults) {
      const validated = validateProviderResult(rawResult.value, request, rawResult.expectedProviderId);
      if ('code' in validated) providerIssues.push(validated);
      else results.push(validated);
    }

    const candidates: Array<{ entry: CatalogEntry; provenance: CatalogProvenance; priority: number }> = [];
    for (const result of results) {
      const provider = this.providers.get(result.providerId);
      if (!provider) {
        providerIssues.push({ providerId: result.providerId, code: 'unknown-provider', message: 'Catalog provider is not registered.' });
        continue;
      }
      if (!provider.families.includes(request.family)) {
        providerIssues.push({ providerId: result.providerId, code: 'unsupported-family', message: 'Catalog provider does not support the requested family.' });
        continue;
      }
      for (const entry of result.entries) {
        if (entry.family !== request.family) {
          providerIssues.push({ providerId: result.providerId, code: 'unsupported-family', message: 'Catalog entry does not match the requested family.' });
          continue;
        }
        candidates.push({
          entry,
          priority: provider.priority ?? 0,
          provenance: {
            providerId: provider.id, providerLabel: provider.label, providerKind: provider.kind,
            source: provider.source, version: provider.version, stale: result.stale ?? false, trusted: provider.trusted ?? false
          }
        });
      }
    }
    for (const entry of customValues) {
      if (!validEntry(entry)) {
        providerIssues.push({ providerId: 'custom', code: 'invalid-envelope', message: 'Custom catalog entry is malformed.' });
        continue;
      }
      if (entry.family !== request.family) continue;
      candidates.push({
        entry,
        priority: 10000,
        provenance: { providerId: 'custom', providerLabel: 'Custom value', providerKind: 'host', source: 'document', version: 'authored', stale: false, trusted: true }
      });
    }

    const canonicalCandidates = new Map<string, typeof candidates[number]>();
    for (const candidate of candidates) {
      const key = `${candidate.entry.family}\u0000${candidate.entry.value}\u0000${candidate.provenance.providerId}`;
      const existing = canonicalCandidates.get(key);
      const candidateScore = rank(candidate.entry, request.query, candidate.priority);
      const existingScore = existing ? rank(existing.entry, request.query, existing.priority) : -1;
      if (!existing || candidateScore > existingScore || (candidateScore === existingScore && entryTieBreak(candidate.entry, existing.entry) < 0)) canonicalCandidates.set(key, candidate);
    }
    const merged = new Map<string, CatalogSuggestion>();
    for (const candidate of [...canonicalCandidates.values()].sort((left, right) =>
      left.provenance.providerId.localeCompare(right.provenance.providerId) || entryTieBreak(left.entry, right.entry))) {
      const score = rank(candidate.entry, request.query, candidate.priority);
      if (score < 0) continue;
      const key = `${candidate.entry.family}\u0000${candidate.entry.value}`;
      const existing = merged.get(key);
      if (!existing || score > existing.score || (score === existing.score && candidate.provenance.providerId.localeCompare(existing.provenance[0].providerId) < 0)) {
        merged.set(key, { ...candidate.entry, emittedJson: JSON.stringify(candidate.entry.value), score, advisory: true, provenance: [candidate.provenance, ...(existing?.provenance ?? [])] });
      } else {
        merged.set(key, { ...existing, provenance: [...existing.provenance, candidate.provenance] });
      }
    }
    const suggestions = [...merged.values()]
      .map((suggestion) => ({ ...suggestion, provenance: [...suggestion.provenance].sort((left, right) => left.providerId.localeCompare(right.providerId)) }))
      .sort((left, right) => right.score - left.score || left.value.localeCompare(right.value) || left.label.localeCompare(right.label))
      .slice(0, request.limit);
    return {
      ...request, kind: 'catalog-merge', cancelled: false, stale: false, suggestions,
      providerIssues: providerIssues.sort((left, right) => left.providerId.localeCompare(right.providerId) || left.code.localeCompare(right.code) || left.message.localeCompare(right.message))
    };
  }
}

const ucum = (value: string, label: string, aliases: readonly string[] = []): CatalogEntry => ({ family: 'ucumUnit', value, label, aliases });
export const BUNDLED_UCUM_ENTRIES: readonly CatalogEntry[] = [
  ucum('1','one'), ucum('%','percent'), ucum('m','metre',['meter']), ucum('cm','centimetre'), ucum('mm','millimetre'), ucum('um','micrometre'), ucum('nm','nanometre'), ucum('km','kilometre'),
  ucum('[in_i]','international inch'), ucum('[ft_i]','international foot'), ucum('[yd_i]','international yard'), ucum('[mi_i]','international mile'), ucum('[nmi_i]','nautical mile'),
  ucum('m2','square metre'), ucum('cm2','square centimetre'), ucum('mm2','square millimetre'), ucum('km2','square kilometre'), ucum('m3','cubic metre'), ucum('cm3','cubic centimetre'), ucum('mm3','cubic millimetre'),
  ucum('L','litre'), ucum('mL','millilitre'), ucum('uL','microlitre'), ucum('[gal_us]','US gallon'), ucum('[gal_br]','imperial gallon'), ucum('[qt_us]','US quart'), ucum('[pt_us]','US pint'),
  ucum('s','second'), ucum('ms','millisecond'), ucum('us','microsecond'), ucum('min','minute'), ucum('h','hour'), ucum('d','day'), ucum('wk','week'), ucum('mo','month'), ucum('a','year'),
  ucum('Hz','hertz'), ucum('kHz','kilohertz'), ucum('MHz','megahertz'), ucum('GHz','gigahertz'), ucum('m/s','metres per second'), ucum('km/h','kilometres per hour'), ucum('m/s2','metres per second squared'),
  ucum('g','gram'), ucum('mg','milligram'), ucum('ug','microgram'), ucum('kg','kilogram'), ucum('[lb_av]','avoirdupois pound'), ucum('[oz_av]','avoirdupois ounce'), ucum('t','metric tonne'),
  ucum('K','kelvin'), ucum('Cel','degree Celsius'), ucum('[degF]','degree Fahrenheit'), ucum('mol','mole'), ucum('mmol','millimole'), ucum('umol','micromole'),
  ucum('A','ampere'), ucum('mA','milliampere'), ucum('V','volt'), ucum('mV','millivolt'), ucum('kV','kilovolt'), ucum('Ohm','ohm'), ucum('kOhm','kilohm'), ucum('S','siemens'),
  ucum('W','watt'), ucum('mW','milliwatt'), ucum('kW','kilowatt'), ucum('MW','megawatt'), ucum('J','joule'), ucum('kJ','kilojoule'), ucum('MJ','megajoule'), ucum('Wh','watt hour'), ucum('kWh','kilowatt hour'),
  ucum('N','newton'), ucum('kN','kilonewton'), ucum('Pa','pascal'), ucum('kPa','kilopascal'), ucum('MPa','megapascal'), ucum('bar','bar'), ucum('mbar','millibar'), ucum('atm','standard atmosphere'), ucum('mm[Hg]','millimetre of mercury'),
  ucum('C','coulomb'), ucum('F','farad'), ucum('H','henry'), ucum('Wb','weber'), ucum('T','tesla'), ucum('lm','lumen'), ucum('lx','lux'), ucum('cd','candela'),
  ucum('rad','radian'), ucum('deg','degree of arc'), ucum('sr','steradian'), ucum('Bq','becquerel'), ucum('Gy','gray'), ucum('Sv','sievert'), ucum('kat','katal'),
  ucum('bit','bit'), ucum('By','byte'), ucum('kbit','kilobit'), ucum('Mbit','megabit'), ucum('Gbit','gigabit'), ucum('kBy','kilobyte'), ucum('MBy','megabyte'), ucum('GBy','gigabyte'), ucum('bit/s','bits per second'), ucum('By/s','bytes per second'),
  ucum('g/L','grams per litre'), ucum('mg/L','milligrams per litre'), ucum('mmol/L','millimoles per litre'), ucum('mol/m3','moles per cubic metre'), ucum('kg/m3','kilograms per cubic metre'), ucum('N.m','newton metre')
];

const currency = (value: string, label: string): CatalogEntry => ({ family: 'currency', value, label });
export const BUNDLED_ISO_4217_ENTRIES: readonly CatalogEntry[] = [
  currency('AED','UAE dirham'), currency('AFN','Afghani'), currency('ALL','Lek'), currency('AMD','Armenian dram'), currency('ANG','Netherlands Antillean guilder'), currency('AOA','Kwanza'), currency('ARS','Argentine peso'), currency('AUD','Australian dollar'), currency('AWG','Aruban florin'), currency('AZN','Azerbaijan manat'),
  currency('BAM','Convertible mark'), currency('BBD','Barbados dollar'), currency('BDT','Taka'), currency('BGN','Bulgarian lev'), currency('BHD','Bahraini dinar'), currency('BIF','Burundi franc'), currency('BMD','Bermudian dollar'), currency('BND','Brunei dollar'), currency('BOB','Boliviano'), currency('BOV','Mvdol'), currency('BRL','Brazilian real'), currency('BSD','Bahamian dollar'), currency('BTN','Ngultrum'), currency('BWP','Pula'), currency('BYN','Belarusian ruble'), currency('BZD','Belize dollar'),
  currency('CAD','Canadian dollar'), currency('CDF','Congolese franc'), currency('CHE','WIR euro'), currency('CHF','Swiss franc'), currency('CHW','WIR franc'), currency('CLF','Unidad de Fomento'), currency('CLP','Chilean peso'), currency('CNY','Renminbi'), currency('COP','Colombian peso'), currency('COU','Unidad de Valor Real'), currency('CRC','Costa Rican colon'), currency('CUP','Cuban peso'), currency('CVE','Cabo Verde escudo'), currency('CZK','Czech koruna'),
  currency('DJF','Djibouti franc'), currency('DKK','Danish krone'), currency('DOP','Dominican peso'), currency('DZD','Algerian dinar'), currency('EGP','Egyptian pound'), currency('ERN','Nakfa'), currency('ETB','Ethiopian birr'), currency('EUR','Euro'), currency('FJD','Fiji dollar'), currency('FKP','Falkland Islands pound'),
  currency('GBP','Pound sterling'), currency('GEL','Lari'), currency('GHS','Ghana cedi'), currency('GIP','Gibraltar pound'), currency('GMD','Dalasi'), currency('GNF','Guinean franc'), currency('GTQ','Quetzal'), currency('GYD','Guyana dollar'), currency('HKD','Hong Kong dollar'), currency('HNL','Lempira'), currency('HTG','Gourde'), currency('HUF','Forint'),
  currency('IDR','Rupiah'), currency('ILS','New Israeli shekel'), currency('INR','Indian rupee'), currency('IQD','Iraqi dinar'), currency('IRR','Iranian rial'), currency('ISK','Iceland krona'), currency('JMD','Jamaican dollar'), currency('JOD','Jordanian dinar'), currency('JPY','Yen'), currency('KES','Kenyan shilling'), currency('KGS','Som'), currency('KHR','Riel'), currency('KMF','Comorian franc'), currency('KPW','North Korean won'), currency('KRW','Won'), currency('KWD','Kuwaiti dinar'), currency('KYD','Cayman Islands dollar'), currency('KZT','Tenge'),
  currency('LAK','Lao kip'), currency('LBP','Lebanese pound'), currency('LKR','Sri Lanka rupee'), currency('LRD','Liberian dollar'), currency('LSL','Loti'), currency('LYD','Libyan dinar'), currency('MAD','Moroccan dirham'), currency('MDL','Moldovan leu'), currency('MGA','Malagasy ariary'), currency('MKD','Denar'), currency('MMK','Kyat'), currency('MNT','Tugrik'), currency('MOP','Pataca'), currency('MRU','Ouguiya'), currency('MUR','Mauritius rupee'), currency('MVR','Rufiyaa'), currency('MWK','Malawi kwacha'), currency('MXN','Mexican peso'), currency('MXV','Mexican Unidad de Inversion'), currency('MYR','Malaysian ringgit'), currency('MZN','Mozambique metical'),
  currency('NAD','Namibia dollar'), currency('NGN','Naira'), currency('NIO','Cordoba oro'), currency('NOK','Norwegian krone'), currency('NPR','Nepalese rupee'), currency('NZD','New Zealand dollar'), currency('OMR','Rial Omani'), currency('PAB','Balboa'), currency('PEN','Sol'), currency('PGK','Kina'), currency('PHP','Philippine peso'), currency('PKR','Pakistan rupee'), currency('PLN','Zloty'), currency('PYG','Guarani'),
  currency('QAR','Qatari rial'), currency('RON','Romanian leu'), currency('RSD','Serbian dinar'), currency('RUB','Russian ruble'), currency('RWF','Rwanda franc'), currency('SAR','Saudi riyal'), currency('SBD','Solomon Islands dollar'), currency('SCR','Seychelles rupee'), currency('SDG','Sudanese pound'), currency('SEK','Swedish krona'), currency('SGD','Singapore dollar'), currency('SHP','Saint Helena pound'), currency('SLE','Leone'), currency('SOS','Somali shilling'), currency('SRD','Surinam dollar'), currency('SSP','South Sudanese pound'), currency('STN','Dobra'), currency('SVC','El Salvador colon'), currency('SYP','Syrian pound'), currency('SZL','Lilangeni'),
  currency('THB','Baht'), currency('TJS','Somoni'), currency('TMT','Turkmenistan manat'), currency('TND','Tunisian dinar'), currency('TOP','Paanga'), currency('TRY','Turkish lira'), currency('TTD','Trinidad and Tobago dollar'), currency('TWD','New Taiwan dollar'), currency('TZS','Tanzanian shilling'), currency('UAH','Hryvnia'), currency('UGX','Uganda shilling'), currency('USD','US dollar'), currency('USN','US dollar next day'), currency('UYI','Uruguay Peso en Unidades Indexadas'), currency('UYU','Peso Uruguayo'), currency('UYW','Unidad Previsional'), currency('UZS','Uzbekistan sum'),
  currency('VED','Bolivar soberano'), currency('VES','Bolivar soberano'), currency('VND','Dong'), currency('VUV','Vatu'), currency('WST','Tala'), currency('XAF','CFA franc BEAC'), currency('XAG','Silver'), currency('XAU','Gold'), currency('XBA','European Composite Unit'), currency('XBB','European Monetary Unit'), currency('XBC','European Unit of Account 9'), currency('XBD','European Unit of Account 17'), currency('XCD','East Caribbean dollar'), currency('XCG','Caribbean guilder'), currency('XDR','Special drawing rights'), currency('XOF','CFA franc BCEAO'), currency('XPD','Palladium'), currency('XPF','CFP franc'), currency('XPT','Platinum'), currency('XSU','SUCRE'), currency('XTS','Testing code'), currency('XUA','ADB Unit of Account'), currency('XXX','No currency'), currency('YER','Yemeni rial'), currency('ZAR','Rand'), currency('ZMW','Zambian kwacha'), currency('ZWG','Zimbabwe Gold')
];

export const BUNDLED_UCUM_PROVIDER: CatalogProviderManifest = {
  id: 'bundled.ucum', label: 'UCUM', kind: 'bundled', families: ['ucumUnit'], source: 'https://ucum.org/ucum', version: '2017-11-21', priority: 100, trusted: true
};
export const BUNDLED_ISO_4217_PROVIDER: CatalogProviderManifest = {
  id: 'bundled.iso-4217', label: 'ISO 4217', kind: 'bundled', families: ['currency'], source: 'https://www.iso.org/iso-4217-currency-codes.html', version: 'seed-2026-08-31', priority: 100, trusted: true
};
export function bundledCatalogResult(request: CatalogSearchRequest, providerId: string): CatalogProviderResult {
  const entries = providerId === BUNDLED_UCUM_PROVIDER.id ? BUNDLED_UCUM_ENTRIES : providerId === BUNDLED_ISO_4217_PROVIDER.id ? BUNDLED_ISO_4217_ENTRIES : [];
  return { ...request, kind: 'catalog-results', providerId, entries };
}