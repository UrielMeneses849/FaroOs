import { describe, expect, it } from 'vitest'
import { parseNuReceipt } from './nuReceiptParser'

describe('parseNuReceipt', () => {
  it('extracts a Nu transfer without mistaking CLABE or folio for the amount', () => {
    expect(parseNuReceipt('Comprobante de transferencia\nMonto\n$1,250.00\nFecha 01 de octubre de 2026\nConcepto\nTransferencia\nNombre\nAna López\nCLABE\n123456789012345678\nFolio 999999').amountCents).toBe(125000)
  })
  it('suggests a useful name and date while ignoring account numbers', () => {
    expect(parseNuReceipt('Monto $290.00\n01/10/2026\nConcepto Cena\nNombre María Pérez\nCuenta 1234567890')).toMatchObject({ amountCents: 29000, date: '2026-10-01', suggestedName: 'Cena' })
  })
  it('leaves the amount unknown when it is not printed with decimals', () => {
    expect(parseNuReceipt('CLABE 123456789012345678\nFolio 9900123').amountCents).toBeUndefined()
  })
})
