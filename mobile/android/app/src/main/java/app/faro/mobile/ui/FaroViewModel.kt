package app.faro.mobile.ui

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import app.faro.mobile.data.CalendarEntry
import app.faro.mobile.data.EventDraft
import app.faro.mobile.data.ExpenseDraft
import app.faro.mobile.data.FaroRepository
import app.faro.mobile.data.FaroSession
import app.faro.mobile.data.FaroTask
import app.faro.mobile.data.FinanceAccount
import app.faro.mobile.data.FinanceCategory
import app.faro.mobile.data.FinanceRecurringOccurrence
import app.faro.mobile.data.FinanceRecurringTransaction
import app.faro.mobile.data.FinanceTransaction
import app.faro.mobile.data.HomeSnapshot
import app.faro.mobile.data.NeedDraft
import app.faro.mobile.data.NeedItem
import app.faro.mobile.data.NeedsCategory
import app.faro.mobile.data.PendingVoiceAction
import app.faro.mobile.data.TaskDraft
import app.faro.mobile.data.VoiceResponse
import app.faro.mobile.data.VoiceTurn
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class FaroUiState(
  val session: FaroSession? = null,
  val loading: Boolean = false,
  val error: String? = null,
  val home: HomeSnapshot = HomeSnapshot(),
  val transactions: List<FinanceTransaction> = emptyList(),
  val accounts: List<FinanceAccount> = emptyList(),
  val categories: List<FinanceCategory> = emptyList(),
  val recurring: List<FinanceRecurringTransaction> = emptyList(),
  val recurringOccurrences: List<FinanceRecurringOccurrence> = emptyList(),
  val needs: List<NeedItem> = emptyList(),
  val needCategories: List<NeedsCategory> = emptyList(),
  val tasks: List<FaroTask> = emptyList(),
  val workspaces: List<app.faro.mobile.data.Workspace> = emptyList(),
  val events: List<CalendarEntry> = emptyList(),
  val voice: VoiceResponse? = null,
  val pendingAction: PendingVoiceAction? = null,
)

class FaroViewModel(private val repository: FaroRepository) : ViewModel() {
  private val _state = MutableStateFlow(FaroUiState(session = repository.currentSession()))
  val state: StateFlow<FaroUiState> = _state.asStateFlow()
  private val history = mutableListOf<VoiceTurn>()

  init { if (_state.value.session != null) refresh() }

  fun signIn(email: String, password: String) = execute {
    repository.signIn(email, password)
    _state.value = _state.value.copy(session = repository.currentSession())
    refreshInternal()
  }

  fun signOut() = execute {
    repository.signOut()
    history.clear()
    _state.value = FaroUiState()
  }

  fun refresh() = execute { refreshInternal() }

  private suspend fun refreshInternal() {
    val home = repository.loadHome()
    val transactions = repository.listTransactions()
    val accounts = repository.listAccounts()
    val categories = repository.listCategories()
    // Planning is additive: a user can still use the rest of the app while a
    // newly-created recurrence table has no rows or is temporarily unavailable.
    val recurring = runCatching { repository.listRecurringTransactions() }.getOrDefault(emptyList())
    val recurringOccurrences = runCatching { repository.listRecurringOccurrences() }.getOrDefault(emptyList())
    // Needs is intentionally isolated from finance. Older installs can still
    // use FARO while the app receives this additive surface.
    val needs = runCatching { repository.listNeeds() }.getOrDefault(emptyList())
    val needCategories = runCatching { repository.listNeedCategories() }.getOrDefault(emptyList())
    val tasks = repository.listTasks()
    val workspaces = repository.listWorkspaces()
    val events = repository.listCalendarEntries()
    _state.value = _state.value.copy(
      session = repository.currentSession(), home = home, transactions = transactions,
      accounts = accounts, categories = categories, recurring = recurring, recurringOccurrences = recurringOccurrences,
      needs = needs, needCategories = needCategories,
      tasks = tasks, workspaces = workspaces, events = events,
    )
  }

  fun createExpense(draft: ExpenseDraft) = execute {
    repository.createExpense(draft); refreshInternal()
  }

  fun updateTransaction(transaction: FinanceTransaction) = execute { repository.updateTransaction(transaction); refreshInternal() }
  fun deleteTransaction(id: String) = execute { repository.deleteTransaction(id); refreshInternal() }
  fun createNeed(draft: NeedDraft) = execute { repository.createNeed(draft); refreshInternal() }
  fun completeNeed(item: NeedItem) = execute { repository.completeNeed(item); refreshInternal() }
  fun createNeedCategory(name: String, shoppingGroup: String) = execute { repository.createNeedCategory(name, shoppingGroup); refreshInternal() }

  fun addLightMealGroceries() = execute {
    var foodCategory = _state.value.needCategories.firstOrNull { it.shoppingGroup == "supermarket" && it.name.trim().equals("Comida", ignoreCase = true) }
    if (foodCategory == null) foodCategory = repository.createNeedCategory("Comida", "supermarket")
    val existing = _state.value.needs
      .filter { it.shoppingGroup == "supermarket" && it.isOnShoppingList }
      .map { it.name.trim().lowercase() }
      .toSet()
    mealGroceries.filter { it.first.trim().lowercase() !in existing }.forEach { (name, quantity) ->
      repository.createNeed(NeedDraft(name = name, shoppingGroup = "supermarket", categoryId = foodCategory.id, quantity = quantity, notes = "Lista base · comidas ligeras"))
    }
    refreshInternal()
  }
  fun createTask(draft: TaskDraft) = execute { repository.createTask(draft); refreshInternal() }
  fun updateTask(task: FaroTask) = execute { repository.updateTask(task); refreshInternal() }
  fun deleteTask(id: String) = execute { repository.deleteTask(id); refreshInternal() }
  fun updateTaskStatus(task: FaroTask, status: String) = execute { repository.setTaskStatus(task, status); refreshInternal() }
  fun createEvent(draft: EventDraft) = execute { repository.createFaroEvent(draft); refreshInternal() }
  fun updateEvent(event: CalendarEntry) = execute { repository.updateFaroEvent(event); refreshInternal() }
  fun deleteEvent(id: String) = execute { repository.deleteFaroEvent(id); refreshInternal() }

  fun sendVoice(transcript: String) = execute {
    val response = repository.sendVoice(transcript, history.takeLast(6))
    history += VoiceTurn("user", transcript)
    history += VoiceTurn("assistant", response.message)
    _state.value = _state.value.copy(voice = response, pendingAction = response.pendingAction)
  }

  fun confirmVoice() = execute {
    val action = _state.value.pendingAction ?: return@execute
    val response = repository.confirmVoice(action)
    history += VoiceTurn("assistant", response.message)
    _state.value = _state.value.copy(voice = response, pendingAction = response.pendingAction)
    refreshInternal()
  }

  fun cancelVoice() = execute {
    val action = _state.value.pendingAction ?: return@execute
    val response = repository.cancelVoice(action)
    _state.value = _state.value.copy(voice = response, pendingAction = null)
  }

  fun clearError() { _state.value = _state.value.copy(error = null) }

  private fun execute(block: suspend () -> Unit) = viewModelScope.launch {
    _state.value = FaroStateReducer.loading(_state.value, true)
    runCatching { block() }.onFailure { error ->
      // Keep the backend error observable in debug logs without recording
      // credentials, payloads, or other personal data.
      Log.e("FaroMobile", "Sync operation failed", error)
      _state.value = FaroStateReducer.failed(_state.value, error.message ?: "No pudimos completar la acción.")
    }
    _state.value = FaroStateReducer.loading(_state.value, false)
  }
}

private val mealGroceries = listOf(
  "Pechuga de pollo" to "1 kg", "Atún en agua" to "4 latas", "Salmón" to "2 filetes", "Huevos" to "1 docena",
  "Tofu natural" to "2 bloques", "Lentejas" to "500 g", "Garbanzos" to "2 latas", "Yogur griego natural" to "1 bote",
  "Arroz integral" to "1 bolsa", "Avena" to "1 bolsa", "Tortillas de maíz" to "1 paquete", "Pan integral" to "1 paquete",
  "Brócoli" to "2 cabezas", "Espinaca" to "1 bolsa", "Calabacita" to "4 piezas", "Champiñones" to "1 paquete",
  "Zanahoria" to "1 bolsa", "Pimiento morrón" to "3 piezas", "Pepino" to "2 piezas", "Jitomate" to "1 kg",
  "Camote" to "3 piezas", "Aguacate" to "4 piezas", "Limón" to "1 kg", "Fruta de temporada" to "1 kg",
)

class FaroViewModelFactory(private val repository: FaroRepository) : ViewModelProvider.Factory {
  @Suppress("UNCHECKED_CAST")
  override fun <T : ViewModel> create(modelClass: Class<T>): T = FaroViewModel(repository) as T
}
