package app.faro.mobile.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Payload builders keep Android writes aligned with the columns and rules used by Web/Desktop. */
object MobilePayloads {
  fun expense(userId: String, id: String, draft: ExpenseDraft): JsonObject {
    validateExpense(draft)
    return buildJsonObject {
      put("id", id); put("user_id", userId); put("account_id", draft.accountId); put("category_id", draft.categoryId)
      put("type", draft.type); put("amount", draft.amount); put("transaction_date", draft.date)
      put("description", draft.description.trim()); put("status", "completed")
    }
  }

  fun task(userId: String, id: String, draft: TaskDraft): JsonObject {
    require(draft.title.trim().isNotEmpty()) { "La tarea necesita título." }
    return buildJsonObject {
      put("id", id); put("user_id", userId); put("title", draft.title.trim())
      put("description", draft.description.ifBlank { "" }); put("notes", draft.description.ifBlank { "" })
      put("area", "Personal"); put("status", "todo"); put("priority", draft.priority); put("sort_order", 0)
      draft.workspaceId?.let { put("workspace_id", it) }; draft.dueAt?.let { put("due_at", it) }
      draft.estimatedMinutes?.let { put("estimated_minutes", it) }
    }
  }

  fun event(userId: String, draft: EventDraft): JsonObject {
    require(draft.title.trim().isNotEmpty()) { "El evento necesita título." }
    require(draft.endsAt > draft.startsAt) { "La hora final debe ser posterior al inicio." }
    return buildJsonObject {
      put("user_id", userId); put("title", draft.title.trim()); put("description", draft.description.ifBlank { "" })
      put("kind", "event"); put("starts_at", draft.startsAt); put("ends_at", draft.endsAt); put("all_day", false)
      draft.workspaceId?.let { put("workspace_id", it) }
    }
  }

  /** Needs are organizational only. This payload never writes a finance transaction. */
  fun need(userId: String, id: String, draft: NeedDraft): JsonObject {
    require(draft.name.trim().isNotEmpty()) { "Escribe qué hace falta." }
    require(draft.shoppingGroup in setOf("supermarket", "pharmacy", "cat", "home", "other")) { "La lista no es válida." }
    val category = when (draft.shoppingGroup) {
      "pharmacy" -> "personal"
      "cat" -> "cat"
      "other" -> "other"
      else -> "home"
    }
    return buildJsonObject {
      put("id", id); put("user_id", userId); put("name", draft.name.trim())
      put("category", category); put("shopping_group", draft.shoppingGroup)
      put("priority", "soon"); put("frequency", "as_needed")
      put("is_on_shopping_list", true); put("is_active", true)
      put("category_id", draft.categoryId?.let(::JsonPrimitive) ?: JsonNull)
      put("quantity", draft.quantity?.trim()?.takeIf { it.isNotEmpty() }?.let(::JsonPrimitive) ?: JsonNull)
      put("estimated_amount", draft.estimatedAmount?.let(::JsonPrimitive) ?: JsonNull)
      put("notes", draft.notes?.trim()?.takeIf { it.isNotEmpty() }?.let(::JsonPrimitive) ?: JsonNull)
    }
  }

  fun needCategory(userId: String, id: String, name: String, shoppingGroup: String): JsonObject {
    require(name.trim().isNotEmpty()) { "Escribe el nombre de la categoría." }
    require(shoppingGroup in setOf("supermarket", "pharmacy", "cat", "home", "other")) { "La lista no es válida." }
    return buildJsonObject {
      put("id", id); put("user_id", userId); put("name", name.trim()); put("shopping_group", shoppingGroup)
    }
  }

  fun validateExpense(draft: ExpenseDraft) {
    require(draft.amount > 0) { "El monto debe ser mayor que cero." }
    require(draft.accountId.isNotBlank()) { "Selecciona una cuenta." }
    require(draft.categoryId.isNotBlank()) { "Selecciona una categoría." }
    require(draft.description.trim().isNotEmpty()) { "Agrega una descripción." }
    require(draft.type in setOf("expense", "income")) { "El tipo de movimiento no es válido." }
    require(java.time.LocalDate.parse(draft.date) != null) { "Selecciona una fecha válida." }
  }
}
