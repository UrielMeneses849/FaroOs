package app.faro.mobile.data

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReceiptTextParserTest {
  @Test fun `extracts amount date and recipient from a bank receipt`() {
    val receipt = ReceiptTextParser.parse(
      "Comprobante BBVA.pdf",
      "Comprobante de transferencia BBVA\nMonto: $3,038.00 MXN\nBeneficiario: Zay Meneses\nFecha de operación: 2026-09-04",
      LocalDate.of(2026, 9, 1),
    )
    assertEquals(3038.0, receipt.amount ?: 0.0, 0.001)
    assertEquals("2026-09-04", receipt.date)
    assertEquals("Transferencia a Zay Meneses", receipt.description)
    assertEquals(ReceiptBank.BBVA, receipt.bank)
    assertTrue(receipt.rawTextAvailable)
  }

  @Test fun `accepts European money grouping`() {
    assertEquals(1234.5, ReceiptTextParser.parseAmount("1.234,50") ?: 0.0, 0.001)
  }

  @Test fun `recognizes Nu from a shared receipt`() {
    assertEquals(ReceiptBank.NU, ReceiptTextParser.detectBank("Comprobante Nu México - transferencia"))
  }
}
