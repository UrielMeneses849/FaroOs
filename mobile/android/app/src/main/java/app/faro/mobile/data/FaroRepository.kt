package app.faro.mobile.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

class FaroRepository(private val api: SupabaseApi) {
  fun currentSession(): FaroSession? = api.cachedSession()
  suspend fun signIn(email: String, password: String) = api.signIn(email, password)
  suspend fun signOut() = api.signOut()

  suspend fun loadHome(): HomeSnapshot {
    val today = LocalDate.now().toString()
    val start = "${today}T00:00:00"
    val end = "${today}T23:59:59.999"
    val parts = coroutineScope {
      val transactions = async { listTransactions() }
      val tasks = async { listTasks() }
      val events = async { listCalendarEntries() }
      HomeParts(transactions.await(), tasks.await(), events.await())
    }
    val spent = parts.transactions.filter { it.type == "expense" && it.status == "completed" && it.transactionDate == today }.sumOf { it.amount }
    val operating = parts.transactions.filter { it.status == "completed" }.sumOf { if (it.type == "income") it.amount else -it.amount }
    val now = OffsetDateTime.now().toString()
    return HomeSnapshot(
      nextEvent = parts.events.firstOrNull { it.startsAt >= now },
      spentToday = spent,
      operatingAvailable = operating,
      tasks = parts.tasks.filter { it.status != "done" && it.archivedAt == null }.take(5),
      eventsToday = parts.events.filter { it.startsAt >= start && it.startsAt <= end },
    )
  }

  suspend fun listTransactions(): List<FinanceTransaction> = api.list(
    "finance_transactions", FinanceTransaction.serializer(),
    mapOf("user_id" to "eq.${requireUserId()}", "order" to "transaction_date.desc"),
  )

  suspend fun listAccounts(): List<FinanceAccount> = api.list(
    "finance_accounts", FinanceAccount.serializer(),
    mapOf("user_id" to "eq.${requireUserId()}", "is_active" to "eq.true", "order" to "created_at.asc"),
  )

  suspend fun listCategories(): List<FinanceCategory> = api.list(
    "finance_categories", FinanceCategory.serializer(),
    mapOf("user_id" to "eq.${requireUserId()}", "is_active" to "eq.true", "order" to "name.asc"),
  )

  suspend fun listRecurringTransactions(): List<FinanceRecurringTransaction> = api.list(
    "finance_recurring_transactions", FinanceRecurringTransaction.serializer(),
    mapOf("user_id" to "eq.${requireUserId()}", "is_active" to "eq.true", "order" to "next_occurrence.asc"),
  )

  suspend fun listRecurringOccurrences(): List<FinanceRecurringOccurrence> = api.list(
    "finance_recurring_occurrences", FinanceRecurringOccurrence.serializer(),
    mapOf("user_id" to "eq.${requireUserId()}", "order" to "expected_date.asc"),
  )

  suspend fun listNeeds(): List<NeedItem> = api.list(
    "needs_items", NeedItem.serializer(),
    mapOf("user_id" to "eq.${requireUserId()}", "is_active" to "eq.true", "order" to "created_at.desc"),
  )

  suspend fun listNeedCategories(): List<NeedsCategory> = api.list(
    "needs_categories", NeedsCategory.serializer(),
    mapOf("user_id" to "eq.${requireUserId()}", "order" to "name.asc"),
  )

  suspend fun createNeed(draft: NeedDraft): NeedItem = api.insert(
    "needs_items", MobilePayloads.need(requireUserId(), UUID.randomUUID().toString(), draft),
  )

  suspend fun completeNeed(item: NeedItem): NeedItem = api.update("needs_items", item.id, buildJsonObject {
    put("is_on_shopping_list", false)
    put("last_completed_at", OffsetDateTime.now().toString())
    if (item.frequency == "one_time") put("is_active", false)
  })

  suspend fun createNeedCategory(name: String, shoppingGroup: String): NeedsCategory = api.insert(
    "needs_categories", MobilePayloads.needCategory(requireUserId(), UUID.randomUUID().toString(), name, shoppingGroup),
  )

  suspend fun createExpense(draft: ExpenseDraft): FinanceTransaction {
    return api.insert("finance_transactions", MobilePayloads.expense(requireUserId(), UUID.randomUUID().toString(), draft))
  }

  suspend fun updateTransaction(transaction: FinanceTransaction): FinanceTransaction = api.update(
    "finance_transactions", transaction.id, buildJsonObject {
      put("description", transaction.description.trim()); put("amount", transaction.amount)
      put("transaction_date", transaction.transactionDate); put("account_id", transaction.accountId)
    put("category_id", transaction.categoryId?.let(::JsonPrimitive) ?: JsonNull); put("status", transaction.status)
    },
  )

  /** Calls the same safe delete RPC used by Web/Desktop. */
  suspend fun deleteTransaction(id: String) = api.callRpc(
    "delete_finance_transaction_safely", buildJsonObject { put("target_transaction_id", id) },
  )

  suspend fun listTasks(): List<FaroTask> = api.list(
    "tasks", FaroTask.serializer(),
    mapOf("user_id" to "eq.${requireUserId()}", "archived_at" to "is.null", "order" to "updated_at.desc"),
  )

  suspend fun listWorkspaces(): List<Workspace> = api.list(
    "workspaces", Workspace.serializer(),
    mapOf("user_id" to "eq.${requireUserId()}", "is_active" to "eq.true", "order" to "sort_order.asc"),
  )

  suspend fun createTask(draft: TaskDraft): FaroTask {
    return api.insert("tasks", MobilePayloads.task(requireUserId(), UUID.randomUUID().toString(), draft))
  }

  suspend fun updateTask(task: FaroTask): FaroTask = api.update("tasks", task.id, buildJsonObject {
    put("title", task.title.trim()); put("description", task.description ?: "")
    put("status", task.status); put("priority", task.priority)
    put("workspace_id", task.workspaceId?.let(::JsonPrimitive) ?: JsonNull)
    put("due_at", task.dueAt?.let(::JsonPrimitive) ?: JsonNull)
    put("estimated_minutes", task.estimatedMinutes?.let(::JsonPrimitive) ?: JsonNull)
    if (task.status == "done") put("completed_at", OffsetDateTime.now().toString())
  })

  suspend fun setTaskStatus(task: FaroTask, status: String): FaroTask = updateTask(task.copy(status = status))
  suspend fun deleteTask(id: String) = api.delete("tasks", id)

  suspend fun listCalendarEntries(): List<CalendarEntry> {
    val faro: List<CalendarEntry> = api.list(
      "calendar_entries", CalendarEntry.serializer(),
      mapOf("user_id" to "eq.${requireUserId()}", "order" to "starts_at.asc"),
    )
    val google: List<CalendarFixture> = runCatching {
      api.list(
        "calendar_voice_fixtures", CalendarFixture.serializer(),
        mapOf("user_id" to "eq.${requireUserId()}", "order" to "starts_at.asc"),
      )
    }.getOrDefault(emptyList())
    return (faro + google.map {
      CalendarEntry(id = "google:${it.id}", title = it.title, kind = "google", startsAt = it.startsAt, endsAt = it.endsAt)
    }).sortedBy { it.startsAt }
  }

  suspend fun createFaroEvent(draft: EventDraft): CalendarEntry {
    return api.insert("calendar_entries", MobilePayloads.event(requireUserId(), draft))
  }

  suspend fun updateFaroEvent(event: CalendarEntry): CalendarEntry {
    check(!event.id.startsWith("google:")) { "Google Calendar es solo de lectura." }
    return api.update("calendar_entries", event.id, buildJsonObject {
      put("title", event.title.trim()); put("description", event.description ?: "")
      put("starts_at", event.startsAt); put("ends_at", event.endsAt); put("all_day", event.allDay)
      put("workspace_id", event.workspaceId?.let(::JsonPrimitive) ?: JsonNull)
    })
  }

  suspend fun deleteFaroEvent(id: String) {
    check(!id.startsWith("google:")) { "Google Calendar es solo de lectura." }
    api.delete("calendar_entries", id)
  }

  suspend fun sendVoice(text: String, history: List<VoiceTurn> = emptyList()) = api.sendVoice(text, history)
  suspend fun confirmVoice(action: PendingVoiceAction) = api.confirmVoice(action)
  suspend fun cancelVoice(action: PendingVoiceAction) = api.cancelVoice(action)

  private fun requireUserId(): String = currentSession()?.user?.id ?: throw FaroApiException("Inicia sesión para continuar.")

  private data class HomeParts(val transactions: List<FinanceTransaction>, val tasks: List<FaroTask>, val events: List<CalendarEntry>)
}

@Serializable
private data class CalendarFixture(
  val id: String,
  val title: String,
  @SerialName("starts_at") val startsAt: String,
  @SerialName("ends_at") val endsAt: String,
)
