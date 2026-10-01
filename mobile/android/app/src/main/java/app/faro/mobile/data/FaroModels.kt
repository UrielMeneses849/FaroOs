package app.faro.mobile.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class FaroUser(val id: String, val email: String? = null)

@Serializable
data class FaroSession(
  @SerialName("access_token") val accessToken: String,
  @SerialName("refresh_token") val refreshToken: String,
  @SerialName("expires_in") val expiresIn: Long = 3600,
  val user: FaroUser,
  val createdAtMillis: Long = System.currentTimeMillis(),
)

@Serializable
data class FinanceAccount(
  val id: String,
  val name: String,
  val type: String = "cash",
  @SerialName("initial_balance") val initialBalance: Double = 0.0,
  @SerialName("is_active") val isActive: Boolean = true,
)

@Serializable
data class FinanceCategory(
  val id: String,
  val name: String,
  val type: String = "expense",
  @SerialName("is_active") val isActive: Boolean = true,
)

@Serializable
data class FinanceTransaction(
  val id: String,
  @SerialName("account_id") val accountId: String,
  @SerialName("category_id") val categoryId: String? = null,
  val type: String,
  val amount: Double,
  @SerialName("transaction_date") val transactionDate: String,
  val description: String,
  val status: String = "completed",
  @SerialName("recurring_transaction_id") val recurringTransactionId: String? = null,
  @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class FinanceRecurringTransaction(
  val id: String,
  @SerialName("account_id") val accountId: String,
  val type: String,
  val amount: Double,
  val description: String,
  val frequency: String = "monthly",
  @SerialName("start_date") val startDate: String,
  @SerialName("next_occurrence") val nextOccurrence: String,
  @SerialName("end_date") val endDate: String? = null,
  @SerialName("is_active") val isActive: Boolean = true,
)

@Serializable
data class FinanceRecurringOccurrence(
  val id: String,
  @SerialName("recurring_transaction_id") val recurringTransactionId: String,
  val period: String,
  @SerialName("expected_date") val expectedDate: String,
  val amount: Double? = null,
  val description: String? = null,
  val status: String = "pending",
  @SerialName("transaction_id") val transactionId: String? = null,
)

@Serializable
data class NeedItem(
  val id: String,
  val name: String,
  val category: String = "home",
  @SerialName("category_id") val categoryId: String? = null,
  @SerialName("shopping_group") val shoppingGroup: String = "supermarket",
  val priority: String = "soon",
  val frequency: String = "as_needed",
  @SerialName("is_on_shopping_list") val isOnShoppingList: Boolean = false,
  @SerialName("next_needed_on") val nextNeededOn: String? = null,
  val quantity: String? = null,
  @SerialName("estimated_amount") val estimatedAmount: Double? = null,
  val notes: String? = null,
  @SerialName("is_active") val isActive: Boolean = true,
  @SerialName("last_completed_at") val lastCompletedAt: String? = null,
  @SerialName("created_at") val createdAt: String? = null,
  @SerialName("updated_at") val updatedAt: String? = null,
)

@Serializable
data class NeedsCategory(
  val id: String,
  val name: String,
  @SerialName("shopping_group") val shoppingGroup: String = "supermarket",
  @SerialName("created_at") val createdAt: String? = null,
  @SerialName("updated_at") val updatedAt: String? = null,
)

data class NeedDraft(
  val name: String,
  val shoppingGroup: String = "supermarket",
  val categoryId: String? = null,
  val quantity: String? = null,
  val estimatedAmount: Double? = null,
  val notes: String? = null,
)

@Serializable
data class Workspace(val id: String, val name: String, @SerialName("is_active") val isActive: Boolean = true)

@Serializable
data class FaroTask(
  val id: String,
  val title: String,
  val description: String? = null,
  val status: String = "todo",
  val priority: String = "medium",
  @SerialName("due_at") val dueAt: String? = null,
  @SerialName("estimated_minutes") val estimatedMinutes: Int? = null,
  @SerialName("workspace_id") val workspaceId: String? = null,
  @SerialName("completed_at") val completedAt: String? = null,
  @SerialName("archived_at") val archivedAt: String? = null,
)

@Serializable
data class CalendarEntry(
  val id: String,
  val title: String,
  val description: String? = null,
  val kind: String = "event",
  @SerialName("starts_at") val startsAt: String,
  @SerialName("ends_at") val endsAt: String,
  @SerialName("all_day") val allDay: Boolean = false,
  @SerialName("workspace_id") val workspaceId: String? = null,
)

@Serializable
data class VoiceTurn(val role: String, val content: String)

@Serializable
data class PendingVoiceAction(
  @SerialName("requestId") val requestId: String,
  @SerialName("toolName") val toolName: String,
  val arguments: Map<String, kotlinx.serialization.json.JsonElement> = emptyMap(),
  val summary: String,
)

@Serializable
data class VoiceQuality(
  val skill: String? = null,
  val route: String? = null,
  val provider: String? = null,
  val model: String? = null,
  val timings: Map<String, Double> = emptyMap(),
)

@Serializable
data class VoiceResponse(
  val status: String,
  val message: String,
  val questions: List<String> = emptyList(),
  @SerialName("pendingAction") val pendingAction: PendingVoiceAction? = null,
  val qa: VoiceQuality? = null,
)

data class ExpenseDraft(
  val amount: Double,
  val accountId: String,
  val categoryId: String,
  val description: String,
  val date: String,
  val type: String = "expense",
)

data class TaskDraft(
  val title: String,
  val workspaceId: String?,
  val description: String = "",
  val priority: String = "medium",
  val dueAt: String? = null,
  val estimatedMinutes: Int? = null,
)

data class EventDraft(
  val title: String,
  val startsAt: String,
  val endsAt: String,
  val workspaceId: String? = null,
  val description: String = "",
)

data class HomeSnapshot(
  val nextEvent: CalendarEntry? = null,
  val spentToday: Double = 0.0,
  val operatingAvailable: Double = 0.0,
  val tasks: List<FaroTask> = emptyList(),
  val eventsToday: List<CalendarEntry> = emptyList(),
)
