export type Currency = 'USD' | 'EUR' | 'GBP' | 'MYR' | 'SGD' | 'JPY' | 'KWD';
/** Unsigned plain decimal string; runtime validation enforces precision and bounds. */
export type Decimal = string;
export interface Party { name: string; address?: string }
export interface QuantityItem { description: string; spec?: string; quantity: Decimal; unit: string }
export interface QuotationItem extends QuantityItem { sellUnitPrice: Decimal }
export interface Section<T> { title: string; items: T[] }
interface BaseDocument { number: string; date: string; currency: Currency; issuer: Party; customer: Party; project?: string; notes?: string }
export interface Quotation extends BaseDocument { kind: 'quotation'; validUntil?: string; taxRate?: Decimal; sections: Section<QuotationItem>[] }
export interface BillOfQuantities extends BaseDocument { kind: 'bq'; sections: Section<QuantityItem>[] }
export type BusinessDocument = Quotation | BillOfQuantities;
export interface PreparedQuotationItem extends QuotationItem { spec: string; amount: Decimal }
interface PreparedBase { number: string; date: string; currency: Currency; issuer: Required<Party>; customer: Required<Party>; project: string; notes: string; rowCount: number }
export interface PreparedQuotation extends PreparedBase { kind: 'quotation'; validUntil?: string; taxRate: Decimal; sections: Array<Section<PreparedQuotationItem> & { subtotal: Decimal }>; totals: { subtotal: Decimal; tax: Decimal; total: Decimal } }
export interface PreparedBQ extends PreparedBase { kind: 'bq'; sections: Section<QuantityItem & { spec: string }>[] }
export function prepareDocument(input: Quotation): PreparedQuotation;
export function prepareDocument(input: BillOfQuantities): PreparedBQ;
export function prepareDocument(input: unknown): PreparedQuotation | PreparedBQ;
export function renderHtml(input: unknown): string;
export function escapeHtml(value: unknown): string;
export function htmlFilename(number: string, kind?: 'document' | 'quotation' | 'bq'): string;
export const limits: Readonly<{ sections: number; rows: number; textLength: number; totalTextLength: number; inputBytes: number }>;
