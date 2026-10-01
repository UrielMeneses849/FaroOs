import { describe, expect, it } from 'vitest'
import { parseMexicanAmount, parseSupermarketReceipt } from './receiptParser'

describe('receiptParser', () => {
  it('reads Mexican prices without treating total as a product', () => {
    const receipt = parseSupermarketReceipt(`
      HEB MÉXICO
      ATUN AGUA 140G                 $24.90
      LECHE ENTERA 1L                 31.50
      SUBTOTAL                        $56.40
      IVA                              $0.00
      TOTAL                           $56.40
    `)
    expect(receipt.storeName).toBe('HEB')
    expect(receipt.lines).toEqual([
      { sourceName: 'ATUN AGUA 140G', amountCents: 2490 },
      { sourceName: 'LECHE ENTERA 1L', amountCents: 3150 },
    ])
  })

  it('accepts decimal comma and thousands separators', () => {
    expect(parseMexicanAmount('1,234.50')).toBe(123450)
    expect(parseMexicanAmount('1.234,50')).toBe(123450)
  })
})
