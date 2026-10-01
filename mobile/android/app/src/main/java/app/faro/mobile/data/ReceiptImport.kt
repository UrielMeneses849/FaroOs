package app.faro.mobile.data

import java.time.LocalDate

/** A document or message explicitly handed to FARO through Android Sharesheet. */
data class SharedReceipt(
  val uri: String? = null,
  val mimeType: String? = null,
  val sharedText: String? = null,
  val displayName: String = "Comprobante bancario",
) {
  val key: String = listOf(uri.orEmpty(), mimeType.orEmpty(), sharedText.orEmpty(), displayName).joinToString("|").hashCode().toString()
}

enum class ReceiptBank(val label: String, val accountWords: List<String>) {
  NU("Nu", listOf("nu", "nubank")),
  BBVA("BBVA", listOf("bbva", "bancomer")),
  GENERIC("Banco", emptyList()),
}

/** Only a suggestion: all fields remain editable and require explicit confirmation. */
data class ReceiptAnalysis(
  val sourceLabel: String,
  val bank: ReceiptBank = ReceiptBank.GENERIC,
  val amount: Double? = null,
  val date: String = LocalDate.now().toString(),
  val recipient: String? = null,
  val rawTextAvailable: Boolean = false,
) {
  val description: String = recipient?.let { "Transferencia a $it" } ?: "Transferencia bancaria"
}

/**
 * Conservative, bank-agnostic parser for the text found in a receipt. It only
 * proposes data; it deliberately does not infer an account or write anything.
 */
object ReceiptTextParser {
  private val labelledAmount = Regex(
    """(?is)(?:monto|importe|total|cantidad|transferencia|operaci[oó]n)\D{0,28}(?:MXN|MX\$|\$)?\s*([0-9]{1,3}(?:[,.][0-9]{3})*(?:[,.][0-9]{2})|[0-9]+(?:[,.][0-9]{2})?)""",
  )
  private val currencyAmount = Regex(
    """(?i)(?:MXN|MX\$|\$)\s*([0-9]{1,3}(?:[,.][0-9]{3})*(?:[,.][0-9]{2})|[0-9]+(?:[,.][0-9]{2})?)""",
  )
  private val isoDate = Regex("""\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b""")
  private val localDate = Regex("""\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b""")
  private val recipient = Regex("""(?im)(?:beneficiario|destinatario|receptor|a\s+nombre\s+de)\s*[:\-]?\s*([^\r\n]{3,70})""")

  fun parse(sourceLabel: String, text: String, fallbackDate: LocalDate = LocalDate.now()): ReceiptAnalysis {
    val amount = labelledAmount.find(text)?.groupValues?.getOrNull(1)?.let(::parseAmount)
      ?: currencyAmount.find(text)?.groupValues?.getOrNull(1)?.let(::parseAmount)
    val date = parseDate(text, fallbackDate)
    val recipientName = recipient.find(text)?.groupValues?.getOrNull(1)
      ?.replace(Regex("""\s{2,}"""), " ")?.trim()?.takeIf { it.length in 3..70 }
    return ReceiptAnalysis(sourceLabel, detectBank("$sourceLabel\n$text"), amount, date.toString(), recipientName, text.isNotBlank())
  }

  fun detectBank(text: String): ReceiptBank = when {
    Regex("""(?i)\b(?:nu|nubank|nu\s*m[eé]xico)\b""").containsMatchIn(text) -> ReceiptBank.NU
    Regex("""(?i)\b(?:bbva|bancomer|bbva\s*m[eé]xico)\b""").containsMatchIn(text) -> ReceiptBank.BBVA
    else -> ReceiptBank.GENERIC
  }

  /** Accepts both $1,234.50 and $1.234,50, which are common across Mexican bank apps. */
  fun parseAmount(value: String): Double? {
    val compact = value.replace(Regex("""[^0-9,\.]"""), "")
    if (compact.isBlank()) return null
    val comma = compact.lastIndexOf(',')
    val dot = compact.lastIndexOf('.')
    val normalized = when {
      comma >= 0 && dot >= 0 && comma > dot -> compact.replace(".", "").replace(',', '.')
      comma >= 0 && dot >= 0 -> compact.replace(",", "")
      comma >= 0 && compact.length - comma - 1 in 1..2 -> compact.replace(',', '.')
      dot >= 0 && compact.length - dot - 1 in 1..2 -> compact
      else -> compact.replace(",", "").replace(".", "")
    }
    return normalized.toDoubleOrNull()?.takeIf { it > 0 }
  }

  private fun parseDate(text: String, fallback: LocalDate): LocalDate {
    isoDate.find(text)?.let { match ->
      return runCatching { LocalDate.of(match.groupValues[1].toInt(), match.groupValues[2].toInt(), match.groupValues[3].toInt()) }.getOrDefault(fallback)
    }
    localDate.find(text)?.let { match ->
      return runCatching { LocalDate.of(match.groupValues[3].toInt(), match.groupValues[2].toInt(), match.groupValues[1].toInt()) }.getOrDefault(fallback)
    }
    return fallback
  }
}
