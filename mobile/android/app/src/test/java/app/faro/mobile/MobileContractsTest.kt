package app.faro.mobile

import app.faro.mobile.data.EventDraft
import app.faro.mobile.data.ExpenseDraft
import app.faro.mobile.data.MobilePayloads
import app.faro.mobile.data.PendingVoiceAction
import app.faro.mobile.data.TaskDraft
import app.faro.mobile.navigation.FaroDeepLinks
import app.faro.mobile.navigation.FaroDestination
import app.faro.mobile.navigation.QuickAction
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class MobileContractsTest {
  @Test fun `deep links centralize every quick action`() {
    assertEquals(QuickAction.Expense, FaroDeepLinks.parse("faro://quick/gasto").quickAction)
    assertEquals(QuickAction.Task, FaroDeepLinks.parse("faro://quick/tarea").quickAction)
    assertEquals(QuickAction.Event, FaroDeepLinks.parse("faro://quick/evento").quickAction)
    assertEquals(FaroDestination.Voice, FaroDeepLinks.parse("faro://voice").destination)
    assertEquals(FaroDestination.Home, FaroDeepLinks.parse("https://example.com").destination)
  }

  @Test fun `expense payload uses existing Finance columns and validates input`() {
    val payload = MobilePayloads.expense("user", "transaction", ExpenseDraft(180.0, "account", "food", "Cena", "2026-08-19"))
    assertEquals("expense", payload["type"]?.toString()?.trim('"'))
    assertEquals("user", payload["user_id"]?.toString()?.trim('"'))
    try {
      MobilePayloads.expense("u", "i", ExpenseDraft(0.0, "a", "c", "x", "2026-08-19"))
      fail("Expected invalid amount to be rejected")
    } catch (_: IllegalArgumentException) { }
  }

  @Test fun `income payload uses the same transaction contract without a second mobile backend`() {
    val payload = MobilePayloads.expense(
      "user", "income", ExpenseDraft(10_000.0, "account", "salary", "Pago", "2026-08-19", type = "income"),
    )
    assertEquals("income", payload["type"]?.toString()?.trim('"'))
    assertEquals(10_000.0, payload["amount"]?.toString()?.toDouble())
  }

  @Test fun `task and calendar payloads preserve FARO contracts`() {
    val task = MobilePayloads.task("user", "task", TaskDraft("Revisar repo", "workspace", dueAt = "2026-08-20T13:00:00Z", estimatedMinutes = 60))
    assertEquals("todo", task["status"]?.toString()?.trim('"'))
    assertEquals("2026-08-20T13:00:00Z", task["due_at"]?.toString()?.trim('"'))
    val event = MobilePayloads.event("user", EventDraft("Cambios", "2026-08-20T13:00:00Z", "2026-08-20T14:00:00Z"))
    assertEquals("event", event["kind"]?.toString()?.trim('"'))
  }

  @Test fun `pending action retains edge function request id for exact confirm cancel`() {
    val pending = PendingVoiceAction("request-id", "createExpense", mapOf("amount" to JsonPrimitive(180)), "Gasto de \$180")
    assertEquals("request-id", pending.requestId)
    assertEquals("createExpense", pending.toolName)
    assertTrue(pending.arguments.containsKey("amount"))
  }
}
