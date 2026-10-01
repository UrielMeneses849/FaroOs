package app.faro.mobile.data

import java.time.LocalDate
import java.time.YearMonth

enum class CashflowStatus { SAFE, LOW, NEGATIVE }

data class CashflowCommitment(
  val id: String,
  val label: String,
  val amount: Double,
  val isIncome: Boolean,
)

data class CashflowDay(
  val date: LocalDate,
  val income: Double,
  val expense: Double,
  val balance: Double,
  val commitments: List<CashflowCommitment>,
  val status: CashflowStatus,
)

data class CashflowTimeline(
  val startBalance: Double,
  val floorBalance: Double,
  val uncommittedMargin: Double,
  val days: List<CashflowDay>,
)

/**
 * Mobile mirror of the desktop liquidity pulse. It starts from the current
 * operational amount and applies only remaining, dated commitments so a user
 * can see the low point before deciding on a discretionary purchase.
 */
object CashflowTimelineCalculator {
  fun build(
    startBalance: Double,
    transactions: List<FinanceTransaction>,
    recurring: List<FinanceRecurringTransaction>,
    occurrences: List<FinanceRecurringOccurrence>,
    today: LocalDate = LocalDate.now(),
  ): CashflowTimeline {
    val month = YearMonth.from(today)
    val byDate = mutableMapOf<LocalDate, MutableList<CashflowCommitment>>()
    fun add(date: LocalDate?, commitment: CashflowCommitment) {
      if (date == null || date < today || YearMonth.from(date) != month) return
      byDate.getOrPut(date) { mutableListOf() }.add(commitment)
    }
    fun isLiquidityType(type: String) = type in setOf("income", "refund", "expense", "debt_payment")
    fun isIncome(type: String) = type == "income" || type == "refund"
    fun parse(value: String) = runCatching { LocalDate.parse(value.take(10)) }.getOrNull()

    transactions
      .filter { it.recurringTransactionId == null && it.status in setOf("planned", "pending") && isLiquidityType(it.type) }
      .forEach { transaction -> add(parse(transaction.transactionDate), CashflowCommitment("movement:${transaction.id}", transaction.description, transaction.amount, isIncome(transaction.type))) }

    val period = month.atDay(1).toString()
    recurring.filter { it.isActive && isLiquidityType(it.type) }.forEach { item ->
      val occurrence = occurrences.firstOrNull { it.recurringTransactionId == item.id && it.period == period } ?: return@forEach
      val generatedPayment = occurrence.transactionId?.let { id -> transactions.any { it.id == id && it.status == "completed" } } == true
      if (occurrence.status == "skipped" || (occurrence.status == "paid" && generatedPayment)) return@forEach
      val amount = occurrence.amount ?: return@forEach
      add(parse(occurrence.expectedDate), CashflowCommitment("recurring:${occurrence.id}", occurrence.description ?: item.description, amount, isIncome(item.type)))
    }

    var balance = startBalance
    val unmarked = generateSequence(today) { date -> date.plusDays(1).takeIf { !it.isAfter(month.atEndOfMonth()) } }
      .map { date ->
        val commitments = byDate[date].orEmpty()
        val income = commitments.filter { it.isIncome }.sumOf { it.amount }
        val expense = commitments.filterNot { it.isIncome }.sumOf { it.amount }
        balance += income - expense
        CashflowDay(date, income, expense, balance, commitments, CashflowStatus.SAFE)
      }.toList()
    val floor = unmarked.minOfOrNull { it.balance } ?: startBalance
    val marked = unmarked.map { day -> day.copy(status = when {
      day.balance < 0 -> CashflowStatus.NEGATIVE
      day.balance == floor && day.commitments.isNotEmpty() -> CashflowStatus.LOW
      else -> CashflowStatus.SAFE
    }) }
    return CashflowTimeline(startBalance, floor, maxOf(0.0, floor), marked)
  }
}
