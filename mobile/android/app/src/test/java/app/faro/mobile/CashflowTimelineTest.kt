package app.faro.mobile

import app.faro.mobile.data.CashflowStatus
import app.faro.mobile.data.CashflowTimelineCalculator
import app.faro.mobile.data.FinanceRecurringOccurrence
import app.faro.mobile.data.FinanceRecurringTransaction
import app.faro.mobile.data.FinanceTransaction
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Test

class CashflowTimelineTest {
  @Test fun `places dated payments and income on their exact day`() {
    val timeline = CashflowTimelineCalculator.build(
      startBalance = 800.0,
      today = LocalDate.parse("2026-07-10"),
      transactions = listOf(
        FinanceTransaction("bill", "account", type = "expense", amount = 900.0, transactionDate = "2026-07-12", description = "Compra", status = "planned"),
        FinanceTransaction("income", "account", type = "income", amount = 600.0, transactionDate = "2026-07-20", description = "Cobro", status = "pending"),
      ),
      recurring = listOf(FinanceRecurringTransaction("phone", "account", "expense", 250.0, "Teléfono", startDate = "2026-07-01", nextOccurrence = "2026-07-15")),
      occurrences = listOf(FinanceRecurringOccurrence("phone-jul", "phone", "2026-07-01", "2026-07-15", 250.0)),
    )

    assertEquals(-100.0, timeline.days.first { it.date.toString() == "2026-07-12" }.balance, 0.001)
    assertEquals(-350.0, timeline.floorBalance, 0.001)
    assertEquals(CashflowStatus.NEGATIVE, timeline.days.first { it.date.toString() == "2026-07-15" }.status)
    assertEquals(250.0, timeline.days.first { it.date.toString() == "2026-07-20" }.balance, 0.001)
    assertEquals(0.0, timeline.uncommittedMargin, 0.001)
  }
}
