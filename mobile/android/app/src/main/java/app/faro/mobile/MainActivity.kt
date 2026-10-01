package app.faro.mobile

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.view.HapticFeedbackConstants
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Category
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.KeyboardVoice
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Restaurant
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.faro.mobile.data.AppConfig
import app.faro.mobile.data.CalendarEntry
import app.faro.mobile.data.CashflowStatus
import app.faro.mobile.data.CashflowTimelineCalculator
import app.faro.mobile.data.EventDraft
import app.faro.mobile.data.ExpenseDraft
import app.faro.mobile.data.FaroTask
import app.faro.mobile.data.FinanceTransaction
import app.faro.mobile.data.NeedDraft
import app.faro.mobile.data.NeedItem
import app.faro.mobile.data.NeedsCategory
import app.faro.mobile.data.ReceiptAnalysis
import app.faro.mobile.data.ReceiptExtractor
import app.faro.mobile.data.ReceiptTextParser
import app.faro.mobile.data.SharedReceipt
import app.faro.mobile.data.TaskDraft
import app.faro.mobile.navigation.FaroDeepLink
import app.faro.mobile.navigation.FaroDeepLinks
import app.faro.mobile.navigation.FaroDestination
import app.faro.mobile.navigation.QuickAction
import app.faro.mobile.ui.FaroUiState
import app.faro.mobile.ui.FaroViewModel
import app.faro.mobile.ui.FaroViewModelFactory
import java.time.LocalDate
import java.time.DayOfWeek
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.TextStyle
import java.util.Locale

class MainActivity : ComponentActivity() {
  private var deepLink by mutableStateOf(FaroDeepLink(FaroDestination.Home))
  private var pendingSharedReceipt by mutableStateOf<SharedReceipt?>(null)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    deepLink = FaroDeepLinks.parse(intent?.data)
    pendingSharedReceipt = receiptFrom(intent)
    setContent { FaroMobileApp(deepLink, pendingSharedReceipt, onReceiptHandled = { pendingSharedReceipt = null }) }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    deepLink = FaroDeepLinks.parse(intent.data)
    pendingSharedReceipt = receiptFrom(intent)
  }

  @Suppress("DEPRECATION")
  private fun receiptFrom(intent: Intent?): SharedReceipt? {
    if (intent?.action != Intent.ACTION_SEND) return null
    val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM) ?: intent.clipData?.getItemAt(0)?.uri
    val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.trim()
    if (uri == null && text.isNullOrBlank()) return null
    return SharedReceipt(
      uri = uri?.toString(),
      mimeType = intent.type,
      sharedText = text,
      displayName = uri?.let(::displayNameFor) ?: "Detalle de transferencia",
    )
  }

  private fun displayNameFor(uri: Uri): String {
    val fromProvider = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
      val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
      if (column >= 0 && cursor.moveToFirst()) cursor.getString(column) else null
    }
    return fromProvider?.takeIf { it.isNotBlank() } ?: uri.lastPathSegment?.substringAfterLast('/') ?: "Comprobante bancario"
  }
}

private val FaroBlack = Color(0xFF05070C)
private val FaroSurface = Color(0xFF0A0F18)
private val FaroLine = Color(0xFF253345)
private val FaroBlue = Color(0xFF2F77FF)
private val FaroSoftBlue = Color(0xFF9CC0FF)
private val FaroText = Color(0xFFF3F7FF)
private val FaroMuted = Color(0xFF9BA9BC)
private val FaroRed = Color(0xFFE54956)
private val FaroGreen = Color(0xFF49C997)

@Composable
private fun FaroMobileApp(deepLink: FaroDeepLink, sharedReceipt: SharedReceipt?, onReceiptHandled: () -> Unit) {
  val app = LocalContext.current.applicationContext as FaroApplication
  val vm: FaroViewModel = viewModel(factory = FaroViewModelFactory(app.repository))
  val state by vm.state.collectAsStateWithLifecycle()
  FaroTheme {
    if (state.session == null) LoginScreen(state = state, onLogin = vm::signIn)
    else FaroShell(state, vm, deepLink, sharedReceipt, onReceiptHandled)
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FaroShell(state: FaroUiState, vm: FaroViewModel, deepLink: FaroDeepLink, sharedReceipt: SharedReceipt?, onReceiptHandled: () -> Unit) {
  var destination by rememberSaveable { mutableStateOf<FaroDestination>(deepLink.destination) }
  var quickAction by remember { mutableStateOf<QuickAction?>(deepLink.quickAction) }
  var fullExpenseForm by remember { mutableStateOf(false) }
  var receiptToReview by remember { mutableStateOf<SharedReceipt?>(null) }
  val snackbar = remember { SnackbarHostState() }
  LaunchedEffect(deepLink) {
    destination = deepLink.destination
    quickAction = deepLink.quickAction
  }
  LaunchedEffect(sharedReceipt?.key) {
    sharedReceipt?.let { receipt ->
      destination = FaroDestination.Finance
      quickAction = null
      receiptToReview = receipt
    }
  }
  LaunchedEffect(state.error) { state.error?.let { snackbar.showSnackbar(it); vm.clearError() } }
  Scaffold(
    containerColor = FaroBlack,
    snackbarHost = { SnackbarHost(snackbar) },
    topBar = {
      TopAppBar(
        title = { Text("FARO", fontWeight = FontWeight.Black, letterSpacing = 2.sp) },
        actions = {
          IconButton(onClick = vm::refresh) { Icon(Icons.Default.Refresh, "Actualizar", tint = FaroSoftBlue) }
          TextButton(onClick = vm::signOut) { Text("Salir", color = FaroMuted) }
        },
      )
    },
    bottomBar = {
      FaroNavigation(destination, onDestination = { destination = it })
    },
  ) { padding ->
    AnimatedContent(destination, modifier = Modifier.padding(padding)) { current ->
      when (current) {
        FaroDestination.Home -> HomeScreen(state, onQuick = { quickAction = it })
        FaroDestination.Finance -> FinanceScreen(
          state = state,
          onUpdate = vm::updateTransaction,
          onDelete = vm::deleteTransaction,
          onQuick = { quickAction = QuickAction.Expense },
          onCreateNeed = vm::createNeed,
          onCompleteNeed = vm::completeNeed,
          onCreateNeedCategory = vm::createNeedCategory,
          onAddLightMealGroceries = vm::addLightMealGroceries,
        )
        FaroDestination.Voice -> VoiceScreen(state, vm)
        FaroDestination.Agenda -> AgendaScreen(state, onUpdate = vm::updateEvent, onDelete = vm::deleteEvent, onQuick = { quickAction = QuickAction.Event })
        FaroDestination.Backlog -> BacklogScreen(state, vm::updateTask, vm::updateTaskStatus, vm::deleteTask, onQuick = { quickAction = QuickAction.Task })
      }
    }
  }
  quickAction?.let { action ->
    when (action) {
      QuickAction.Expense -> QuickExpenseSheet(
        state = state,
        onDismiss = { quickAction = null },
        onMoreDetails = { quickAction = null; fullExpenseForm = true },
        onSave = { vm.createExpense(it); quickAction = null },
      )
      QuickAction.Task -> TaskSheet(state, onDismiss = { quickAction = null }, onSave = { vm.createTask(it); quickAction = null })
      QuickAction.Event -> EventSheet(state, onDismiss = { quickAction = null }, onSave = { vm.createEvent(it); quickAction = null })
      QuickAction.Voice -> VoiceQuickSheet(onDismiss = { quickAction = null }, onOpenVoice = { quickAction = null; destination = FaroDestination.Voice })
    }
  }
  if (fullExpenseForm) {
    ExpenseSheet(
      state = state,
      onDismiss = { fullExpenseForm = false },
      onSave = { vm.createExpense(it); fullExpenseForm = false },
    )
  }
  receiptToReview?.let { receipt ->
    ReceiptImportSheet(
      receipt = receipt,
      state = state,
      onDismiss = { receiptToReview = null; onReceiptHandled() },
      onSave = { draft -> vm.createExpense(draft); receiptToReview = null; onReceiptHandled() },
    )
  }
}

@Composable
private fun FaroNavigation(destination: FaroDestination, onDestination: (FaroDestination) -> Unit) {
  val entries = listOf(
    Triple(FaroDestination.Home, "Inicio", Icons.Default.Home),
    Triple(FaroDestination.Finance, "Finanzas", Icons.Default.AccountBalanceWallet),
    Triple(FaroDestination.Voice, "FARO", Icons.Default.KeyboardVoice),
    Triple(FaroDestination.Agenda, "Agenda", Icons.Default.CalendarMonth),
    Triple(FaroDestination.Backlog, "Backlog", Icons.Default.TaskAlt),
  )
  NavigationBar(containerColor = FaroSurface) {
    entries.forEach { (target, label, icon) ->
      NavigationBarItem(
        selected = destination == target, onClick = { onDestination(target) },
        icon = {
          if (target == FaroDestination.Voice) FaroOrb(31.dp, active = destination == FaroDestination.Voice)
          else Icon(icon, label, modifier = Modifier.size(24.dp))
        },
        label = { Text(label, fontSize = 11.sp) },
      )
    }
  }
}

@Composable
private fun LoginScreen(state: FaroUiState, onLogin: (String, String) -> Unit) {
  var email by rememberSaveable { mutableStateOf("") }
  var password by rememberSaveable { mutableStateOf("") }
  Column(
    modifier = Modifier.fillMaxSize().background(FaroBlack).padding(28.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    FaroOrb(112.dp)
    Spacer(Modifier.height(26.dp))
    Text("FARO Mobile", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
    Text("Tu misma sesión, datos y reglas de FARO.", color = FaroMuted, textAlign = TextAlign.Center)
    Spacer(Modifier.height(28.dp))
    OutlinedTextField(email, { email = it }, Modifier.fillMaxWidth(), label = { Text("Correo") }, singleLine = true)
    Spacer(Modifier.height(10.dp))
    OutlinedTextField(password, { password = it }, Modifier.fillMaxWidth(), label = { Text("Contraseña") }, singleLine = true)
    if (!AppConfig.isConfigured) Text("Falta configurar Supabase en local.properties.", color = FaroRed, modifier = Modifier.padding(top = 12.dp))
    Spacer(Modifier.height(18.dp))
    Button(onClick = { onLogin(email, password) }, enabled = !state.loading && AppConfig.isConfigured, modifier = Modifier.fillMaxWidth()) {
      if (state.loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Entrar a FARO")
    }
  }
}

@Composable
private fun HomeScreen(state: FaroUiState, onQuick: (QuickAction) -> Unit) = LazyColumn(
  modifier = Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp, 20.dp, 20.dp, 104.dp), verticalArrangement = Arrangement.spacedBy(14.dp),
) {
  item {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
      Text("BUEN DÍA", color = FaroBlue, fontWeight = FontWeight.Bold, fontSize = 12.sp, letterSpacing = 1.sp)
      Spacer(Modifier.height(12.dp))
      Box(
        Modifier.size(132.dp).clip(CircleShape).border(1.dp, FaroLine, CircleShape).clickable { onQuick(QuickAction.Voice) },
        contentAlignment = Alignment.Center,
      ) { FaroOrb(116.dp, active = true) }
      Spacer(Modifier.height(10.dp))
      Text("Tu operación, en una mirada", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
      Text("Toca el orbe y dile qué necesitas", color = FaroMuted, fontSize = 12.sp, textAlign = TextAlign.Center)
    }
  }
  item {
    SectionCard("ORBE FARO") {
      Text("Tu acceso directo a la operación", fontWeight = FontWeight.Bold)
      Text("Pregúntale, dicta un gasto o crea una tarea. No hace falta encontrar la pantalla primero.", color = FaroMuted, fontSize = 12.sp)
      Text("Toca el orbe para empezar.", color = FaroSoftBlue, fontSize = 12.sp, modifier = Modifier.align(Alignment.End))
    }
  }
  item { QuickGrid(onQuick) }
  item { QuickExpenseGadget(state, onOpen = { onQuick(QuickAction.Expense) }) }
  item { Text("HOY", color = FaroMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp) }
  item { MetricCard("Gasto de hoy", money(state.home.spentToday), "Movimientos completados") }
  item { MetricCard("Disponible operativo", money(state.home.operatingAvailable), "Ingresos menos gastos registrados") }
  item {
    SectionCard("Próximo compromiso") {
      val event = state.home.nextEvent
      Text(event?.title ?: "Sin próximos eventos", fontWeight = FontWeight.Bold)
      Text(event?.startsAt?.localLabel() ?: "Crea uno desde Agenda", color = FaroMuted)
    }
  }
  item {
    SectionCard("Pendientes relevantes") {
      if (state.home.tasks.isEmpty()) Text("No tienes tareas pendientes.", color = FaroMuted)
      state.home.tasks.forEach { TaskLine(it) }
    }
  }
  item {
    SectionCard("Eventos restantes") {
      if (state.home.eventsToday.isEmpty()) Text("No hay más eventos hoy.", color = FaroMuted)
      state.home.eventsToday.forEach { Text("${it.startsAt.localTime()}  ${it.title}", modifier = Modifier.padding(vertical = 4.dp)) }
    }
  }
}

@Composable
private fun QuickGrid(onQuick: (QuickAction) -> Unit) = Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
  listOf("Gasto" to QuickAction.Expense, "Tarea" to QuickAction.Task, "Evento" to QuickAction.Event).forEach { (label, action) ->
    OutlinedButton(onClick = { onQuick(action) }, Modifier.weight(1f).heightIn(min = 54.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(4.dp)) { Text(label, fontSize = 11.sp, textAlign = TextAlign.Center) }
  }
}

@Composable
private fun QuickExpenseGadget(state: FaroUiState, onOpen: () -> Unit) = Card(
  colors = CardDefaults.cardColors(containerColor = Color(0xFF0B1A2C)),
  border = androidx.compose.foundation.BorderStroke(1.dp, FaroBlue),
) {
  Row(
    modifier = Modifier.fillMaxWidth().padding(16.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    Box(Modifier.size(42.dp).clip(CircleShape).background(FaroBlue), contentAlignment = Alignment.Center) {
      Icon(Icons.Default.AccountBalanceWallet, "Gasto rápido", tint = FaroText)
    }
    Column(Modifier.weight(1f)) {
      Text("GASTO RÁPIDO", color = FaroSoftBlue, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
      Text("Regístralo en menos de 10 segundos", fontWeight = FontWeight.Bold)
      Text("${state.accounts.firstOrNull()?.name ?: "Elige una cuenta"} · hoy", color = FaroMuted, fontSize = 11.sp)
    }
    Button(onClick = onOpen, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp)) {
      Text("Agregar", fontSize = 11.sp)
    }
  }
}

@Composable
private fun FinanceScreen(
  state: FaroUiState,
  onUpdate: (FinanceTransaction) -> Unit,
  onDelete: (String) -> Unit,
  onQuick: () -> Unit,
  onCreateNeed: (NeedDraft) -> Unit,
  onCompleteNeed: (NeedItem) -> Unit,
  onCreateNeedCategory: (String, String) -> Unit,
  onAddLightMealGroceries: () -> Unit,
) {
  var editing by remember { mutableStateOf<FinanceTransaction?>(null) }
  var selectedTab by rememberSaveable { mutableStateOf(0) }
  val tabs = listOf("Resumen", "Ingresos", "Gastos", "Necesidades")
  val income = state.transactions.filter { it.type == "income" || it.type == "refund" }
  val expenses = state.transactions.filter { it.type == "expense" || it.type == "debt_payment" }
  Column(Modifier.fillMaxSize()) {
    TabRow(selectedTabIndex = selectedTab, containerColor = FaroSurface, contentColor = FaroText, divider = {}) {
      tabs.forEachIndexed { index, label ->
        Tab(
          selected = selectedTab == index,
          onClick = { selectedTab = index },
          text = { Text(label, fontSize = 10.sp, fontWeight = if (selectedTab == index) FontWeight.Bold else FontWeight.Medium) },
        )
      }
    }
    if (selectedTab == 3) {
      NeedsScreen(state, onCreateNeed, onCompleteNeed, onCreateNeedCategory, onAddLightMealGroceries)
    } else {
      LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp, 20.dp, 20.dp, 104.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { ScreenHeading("Finanzas", "Datos del mismo libro de FARO", onQuick, "Registrar gasto") }
        when (selectedTab) {
          0 -> item { FinanceSummary(state) }
          1 -> {
            item { Text("INGRESOS", color = FaroMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold) }
            items(income, key = { it.id }) { transaction -> TransactionLine(transaction, onEdit = { editing = it }, onDelete) }
            if (income.isEmpty()) item { EmptyState("Aún no hay ingresos registrados.") }
          }
          else -> {
            item { Text("GASTOS", color = FaroMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold) }
            items(expenses, key = { it.id }) { transaction -> TransactionLine(transaction, onEdit = { editing = it }, onDelete) }
            if (expenses.isEmpty()) item { EmptyState("Aún no hay gastos registrados.") }
          }
        }
      }
    }
  }
  editing?.let { transaction -> TransactionEditSheet(transaction, state, onDismiss = { editing = null }, onSave = { onUpdate(it); editing = null }) }
}

@Composable
private fun FinanceSummary(state: FaroUiState) {
  val timeline = remember(state.home.operatingAvailable, state.transactions, state.recurring, state.recurringOccurrences) {
    CashflowTimelineCalculator.build(state.home.operatingAvailable, state.transactions, state.recurring, state.recurringOccurrences)
  }
  val upcoming = timeline.days.filter { it.commitments.isNotEmpty() }
  Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
    MetricCard("Disponible operativo", money(timeline.startBalance), "Saldo registrado hoy")
    SectionCard("PULSO DE LIQUIDEZ") {
      Text("Tu balance día a día", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
      Text("Aplica ingresos y pagos pendientes en la fecha registrada.", color = FaroMuted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
      Spacer(Modifier.height(14.dp))
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        ForecastMetric("Mínimo previsto", money(timeline.floorBalance), if (timeline.floorBalance < 0) FaroRed else FaroText, Modifier.weight(1f))
        ForecastMetric("Margen sin comprometer", money(timeline.uncommittedMargin), if (timeline.uncommittedMargin > 0) Color(0xFF49C997) else FaroText, Modifier.weight(1f))
      }
      Spacer(Modifier.height(12.dp))
      if (timeline.floorBalance < 0) Text("Atención: con los compromisos registrados habría saldo negativo. Revisa esos días antes de sumar una compra.", color = Color(0xFFFFA5AD), fontSize = 12.sp)
      else Text("No se anticipa saldo negativo con el plan registrado. El margen no es una recomendación de compra o inversión.", color = FaroMuted, fontSize = 12.sp)
    }
    if (upcoming.isNotEmpty()) {
      Text("PRÓXIMOS IMPACTOS", color = FaroMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
      upcoming.take(7).forEach { day -> CashflowDayCard(day) }
    } else EmptyState("Agrega gastos o ingresos pendientes con fecha para ver la proyección diaria.")
  }
}

@Composable
private fun NeedsScreen(
  state: FaroUiState,
  onCreateNeed: (NeedDraft) -> Unit,
  onCompleteNeed: (NeedItem) -> Unit,
  onCreateNeedCategory: (String, String) -> Unit,
  onAddLightMealGroceries: () -> Unit,
) {
  var adding by remember { mutableStateOf(false) }
  var managingCategories by remember { mutableStateOf(false) }
  val pending = state.needs.filter { it.isOnShoppingList && it.isActive }
  val totalEstimate = pending.sumOf { it.estimatedAmount ?: 0.0 }
  val grouped = pending.groupBy { it.shoppingGroup }.toSortedMap(compareBy { needGroupOrder(it) })
  LazyColumn(
    modifier = Modifier.fillMaxSize(),
    contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp, 20.dp, 20.dp, 104.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    item {
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
          Text("Necesidades", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Black)
          Text("Despensa y reposición, sin cargos duplicados", color = FaroMuted, fontSize = 13.sp)
        }
        IconButton(onClick = { managingCategories = true }) { Icon(Icons.Default.Category, "Categorías", tint = FaroSoftBlue) }
        OutlinedButton(onClick = { adding = true }) { Icon(Icons.Default.Add, null); Text("Añadir", fontSize = 11.sp) }
      }
    }
    item {
      Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF0B1A2C)), border = androidx.compose.foundation.BorderStroke(1.dp, FaroBlue)) {
        Row(Modifier.fillMaxWidth().padding(18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
          Box(Modifier.size(48.dp).clip(CircleShape).border(2.dp, FaroBlue, CircleShape), contentAlignment = Alignment.Center) { Icon(Icons.Default.ShoppingCart, null, tint = FaroSoftBlue) }
          Column(Modifier.weight(1f)) {
            Text("Faltan ${pending.size} ${if (pending.size == 1) "cosa" else "cosas"}", fontWeight = FontWeight.Black, fontSize = 21.sp)
            Text(if (totalEstimate > 0) "${money(totalEstimate)} estimados · por comprar" else "Por comprar cuando tú decidas", color = FaroMuted, fontSize = 12.sp)
          }
        }
      }
    }
    item { MobileMealPlan(adding = state.loading, onAdd = onAddLightMealGroceries) }
    if (pending.isEmpty()) item { EmptyState("Tu lista de compra está al día. Añade algo en cuanto empiece a faltar.") }
    grouped.forEach { (group, items) ->
      item { Text(groupLabel(group), color = FaroSoftBlue, fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp, modifier = Modifier.padding(top = 4.dp)) }
      items(items, key = { it.id }) { item ->
        NeedShoppingRow(item, state.needCategories.firstOrNull { it.id == item.categoryId }?.name, onCompleteNeed)
      }
    }
    if (state.needs.any { !it.isOnShoppingList && it.isActive }) {
      item { Text("RUTINAS", color = FaroMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp, modifier = Modifier.padding(top = 8.dp)) }
      items(state.needs.filter { !it.isOnShoppingList && it.isActive }.take(5), key = { it.id }) { item ->
        Card(colors = CardDefaults.cardColors(containerColor = FaroSurface), border = androidx.compose.foundation.BorderStroke(1.dp, FaroLine)) {
          Row(Modifier.fillMaxWidth().padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.Refresh, null, tint = FaroMuted)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) { Text(item.name, fontWeight = FontWeight.Bold); Text(item.frequency.frequencyLabel(), color = FaroMuted, fontSize = 11.sp) }
          }
        }
      }
    }
    item {
      Text("Marcar comprado sólo actualiza esta lista. El gasto real se registra desde Finanzas.", color = FaroMuted, fontSize = 11.sp, modifier = Modifier.padding(vertical = 8.dp))
    }
  }
  if (adding) NeedAddSheet(state.needCategories, onDismiss = { adding = false }, onSave = { draft -> onCreateNeed(draft); adding = false })
  if (managingCategories) NeedCategorySheet(state.needCategories, onDismiss = { managingCategories = false }, onSave = onCreateNeedCategory)
}

@Composable
private fun MobileMealPlan(adding: Boolean, onAdd: () -> Unit) = Card(
  colors = CardDefaults.cardColors(containerColor = Color(0xFF0B1723)),
  border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF31557B)),
) {
  Column(Modifier.fillMaxWidth().padding(17.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Icon(Icons.Default.Restaurant, null, tint = FaroGreen)
      Spacer(Modifier.width(8.dp))
      Column(Modifier.weight(1f)) { Text("PLAN LIGERO · SUPERMERCADO", color = FaroSoftBlue, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp); Text("8 comidas para resolver la semana", fontWeight = FontWeight.Bold) }
      OutlinedButton(onClick = onAdd, enabled = !adding) { Text(if (adding) "Añadiendo…" else "Lista base", fontSize = 10.sp) }
    }
    Text("Bowl de pollo y brócoli · Tacos de atún · Ensalada tibia de lentejas · Omelette verde", color = FaroMuted, fontSize = 11.sp, lineHeight = 17.sp)
    Text("Salmón con verduras · Tazón de garbanzos · Salteado de tofu · Yogur con avena y fruta", color = FaroMuted, fontSize = 11.sp, lineHeight = 17.sp)
    Text("Añade sólo los ingredientes que aún no tengas, en Supermercado → Comida.", color = FaroSoftBlue, fontSize = 10.sp)
  }
}

@Composable
private fun NeedShoppingRow(item: NeedItem, categoryName: String?, onComplete: (NeedItem) -> Unit) = Card(
  colors = CardDefaults.cardColors(containerColor = FaroSurface),
  border = androidx.compose.foundation.BorderStroke(1.dp, FaroLine),
) {
  Row(Modifier.fillMaxWidth().padding(13.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
    IconButton(onClick = { onComplete(item) }, modifier = Modifier.size(38.dp).border(1.dp, FaroBlue, CircleShape)) { Icon(Icons.Default.Check, "Marcar comprado", tint = FaroSoftBlue) }
    Column(Modifier.weight(1f)) {
      Text(item.name, fontWeight = FontWeight.Bold)
      val detail = listOfNotNull(item.quantity, categoryName, item.notes?.takeIf { it.isNotBlank() }).joinToString(" · ")
      Text(detail.ifBlank { "Sin detalle" }, color = FaroMuted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    item.estimatedAmount?.let { Text(money(it), fontWeight = FontWeight.Bold, fontSize = 12.sp) }
  }
}

@Composable
private fun NeedAddSheet(categories: List<NeedsCategory>, onDismiss: () -> Unit, onSave: (NeedDraft) -> Unit) {
  var name by remember { mutableStateOf("") }
  var group by remember { mutableStateOf("supermarket") }
  var categoryId by remember { mutableStateOf("") }
  var quantity by remember { mutableStateOf("") }
  var estimate by remember { mutableStateOf("") }
  FormSheet("Añadir a la compra", onDismiss) {
    Text("No hace falta poner una fecha: basta con que notes que está empezando a faltar.", color = FaroMuted, fontSize = 12.sp)
    OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { Text("¿Qué hace falta?") }, singleLine = true)
    Selector("Lista", needGroups.map { it to groupLabel(it) }, group, { group = it; categoryId = "" })
    Selector("Categoría personal", listOf("" to "Sin categoría específica") + categories.filter { it.shoppingGroup == group }.map { it.id to it.name }, categoryId, { categoryId = it })
    OutlinedTextField(quantity, { quantity = it }, Modifier.fillMaxWidth(), label = { Text("Cantidad o presentación") }, singleLine = true)
    OutlinedTextField(estimate, { estimate = it }, Modifier.fillMaxWidth(), label = { Text("Costo estimado (opcional)") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), singleLine = true)
    Button(onClick = { onSave(NeedDraft(name, group, categoryId.ifBlank { null }, quantity.ifBlank { null }, estimate.replace(',', '.').toDoubleOrNull())) }, enabled = name.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("Añadir a mi lista") }
  }
}

@Composable
private fun NeedCategorySheet(categories: List<NeedsCategory>, onDismiss: () -> Unit, onSave: (String, String) -> Unit) {
  var name by remember { mutableStateOf("") }
  var group by remember { mutableStateOf("supermarket") }
  FormSheet("Tus categorías", onDismiss) {
    Text("Crea categorías tuyas como Comida, Limpieza o Proteínas. No cambian ningún gasto.", color = FaroMuted, fontSize = 12.sp)
    OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { Text("Nombre") }, singleLine = true)
    Selector("Lista", needGroups.map { it to groupLabel(it) }, group, { group = it })
    Button(onClick = { onSave(name, group); name = "" }, enabled = name.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("Crear categoría") }
    if (categories.isEmpty()) Text("Aún no tienes categorías personales.", color = FaroMuted, fontSize = 12.sp)
    categories.forEach { category -> Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.Category, null, tint = FaroSoftBlue); Spacer(Modifier.width(8.dp)); Column { Text(category.name, fontWeight = FontWeight.Bold); Text(groupLabel(category.shoppingGroup), color = FaroMuted, fontSize = 11.sp) } } }
  }
}

private val needGroups = listOf("supermarket", "pharmacy", "cat", "home", "other")
private fun groupLabel(group: String) = when (group) { "supermarket" -> "Supermercado"; "pharmacy" -> "Farmacia"; "cat" -> "Mi gata"; "home" -> "Hogar"; else -> "Otro" }
private fun needGroupOrder(group: String) = needGroups.indexOf(group).takeIf { it >= 0 } ?: needGroups.size
private fun String.frequencyLabel() = when (this) { "weekly" -> "Cada semana"; "biweekly" -> "Cada 2 semanas"; "monthly" -> "Cada mes"; "bimonthly" -> "Cada 2 meses"; "quarterly" -> "Cada 3 meses"; "semiannual" -> "Cada 6 meses"; "annual" -> "Cada año"; else -> "Cuando haga falta" }

@Composable
private fun ForecastMetric(label: String, value: String, color: Color, modifier: Modifier = Modifier) = Column(
  modifier.then(Modifier.border(1.dp, FaroLine, RoundedCornerShape(12.dp)).padding(12.dp)),
) { Text(label, color = FaroMuted, fontSize = 10.sp, fontWeight = FontWeight.Bold); Spacer(Modifier.height(5.dp)); Text(value, color = color, fontWeight = FontWeight.Bold, fontSize = 18.sp) }

@Composable
private fun CashflowDayCard(day: app.faro.mobile.data.CashflowDay) = Card(
  colors = CardDefaults.cardColors(containerColor = if (day.status == CashflowStatus.NEGATIVE) Color(0xFF241117) else FaroSurface),
  border = androidx.compose.foundation.BorderStroke(1.dp, if (day.status == CashflowStatus.NEGATIVE) Color(0xFF713B48) else FaroLine),
) {
  Row(Modifier.fillMaxWidth().padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
    Column(Modifier.width(50.dp)) { Text(day.date.dayOfMonth.toString(), color = FaroSoftBlue, fontWeight = FontWeight.Bold, fontSize = 18.sp); Text(day.date.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale("es", "MX")), color = FaroMuted, fontSize = 10.sp) }
    Column(Modifier.weight(1f)) { Text(day.commitments.joinToString(" · ") { it.label }, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis); Text("Saldo tras el día: ${money(day.balance)}", color = FaroMuted, fontSize = 11.sp) }
    val net = day.income - day.expense
    Text("${if (net >= 0) "+" else "−"}${money(kotlin.math.abs(net))}", color = if (net >= 0) Color(0xFF49C997) else FaroRed, fontWeight = FontWeight.Bold, fontSize = 13.sp)
  }
}

@Composable
private fun BacklogScreen(state: FaroUiState, onUpdate: (FaroTask) -> Unit, onStatus: (FaroTask, String) -> Unit, onDelete: (String) -> Unit, onQuick: () -> Unit) {
  var editing by remember { mutableStateOf<FaroTask?>(null) }
  var lane by rememberSaveable { mutableStateOf("focus") }
  val active = state.tasks.filter { it.status in setOf("doing", "todo", "blocked") }
  val focus = active.firstOrNull { it.status == "doing" } ?: active.firstOrNull()
  val completed = state.tasks
    .filter { it.status == "done" }
    .sortedByDescending { it.completedAt ?: "" }
  val activeByStatus = active.groupBy { it.status }

  LazyColumn(
    modifier = Modifier.fillMaxSize(),
    contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp, 20.dp, 20.dp, 104.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    item { ScreenHeading("Backlog", "Tu foco, tu ritmo y lo que ya cerraste", onQuick, "Nueva tarea") }
    item { BacklogFocusCard(focus, active.size, completed.size, onComplete = { focus?.let { onStatus(it, "done") } }) }
    item {
      BacklogLanePicker(
        selected = lane,
        focusCount = activeByStatus["doing"].orEmpty().size,
        pendingCount = activeByStatus["todo"].orEmpty().size + activeByStatus["blocked"].orEmpty().size,
        completedCount = completed.size,
        onSelected = { lane = it },
      )
    }

    if (lane == "focus" || lane == "pending") {
      val groups = if (lane == "focus") {
        listOf("doing" to "En progreso", "todo" to "Siguiente en la fila")
      } else {
        listOf("todo" to "Pendientes", "blocked" to "Necesitan destrabe")
      }
      groups.forEach { (status, title) ->
        val tasks = activeByStatus[status].orEmpty()
        if (tasks.isNotEmpty()) {
          item { BacklogGroupHeading(title, tasks.size) }
          items(tasks, key = { it.id }) { task -> TaskCard(task, onEdit = { editing = it }, onStatus, onDelete) }
        }
      }
      if ((lane == "focus" && activeByStatus["doing"].orEmpty().isEmpty() && activeByStatus["todo"].orEmpty().isEmpty()) ||
        (lane == "pending" && activeByStatus["todo"].orEmpty().isEmpty() && activeByStatus["blocked"].orEmpty().isEmpty())) {
        item { EmptyState("Nada que atender en esta vista. Buen momento para respirar o crear una tarea.") }
      }
    } else {
      val grouped = completed.groupBy { it.completedAt?.eventDate() }
      grouped.forEach { (date, tasks) ->
        item { BacklogGroupHeading(completedDateLabel(date), tasks.size) }
        items(tasks, key = { it.id }) { task -> TaskCard(task, onEdit = { editing = it }, onStatus, onDelete) }
      }
      if (completed.isEmpty()) item { EmptyState("Todavía no hay tareas cerradas. Cuando termines una, aparecerá aquí arriba.") }
    }
  }
  editing?.let { task -> TaskEditSheet(task, state, onDismiss = { editing = null }, onSave = { onUpdate(it); editing = null }) }
}

@Composable
private fun BacklogFocusCard(task: FaroTask?, activeCount: Int, completedCount: Int, onComplete: () -> Unit) = Card(
  colors = CardDefaults.cardColors(containerColor = Color(0xFF0B1A2C)),
  border = androidx.compose.foundation.BorderStroke(1.dp, FaroBlue),
) {
  Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Text("FOCO ACTUAL", color = FaroSoftBlue, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
    Text(task?.title ?: "Tu backlog está libre por ahora", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Black, maxLines = 2, overflow = TextOverflow.Ellipsis)
    Text(
      task?.let { "${task.priority.label()} · ${task.estimatedMinutes?.let { minutes -> "${minutes} min" } ?: "sin duración"}" }
        ?: "${completedCount} cerradas · ${activeCount} abiertas",
      color = FaroMuted,
      fontSize = 12.sp,
    )
    if (task != null) {
      Button(onClick = onComplete, modifier = Modifier.align(Alignment.End)) {
        Icon(Icons.Default.Check, "Completar")
        Spacer(Modifier.width(6.dp))
        Text("Cerrar foco")
      }
    }
  }
}

@Composable
private fun BacklogLanePicker(selected: String, focusCount: Int, pendingCount: Int, completedCount: Int, onSelected: (String) -> Unit) = Row(
  Modifier.fillMaxWidth(),
  horizontalArrangement = Arrangement.spacedBy(8.dp),
) {
  listOf("focus" to "Ahora · ${focusCount}", "pending" to "Pendiente · ${pendingCount}", "done" to "Cerradas · ${completedCount}").forEach { (id, label) ->
    if (id == selected) {
      Button(onClick = { onSelected(id) }, modifier = Modifier.weight(1f), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 6.dp)) {
        Text(label, fontSize = 10.sp, maxLines = 1)
      }
    } else {
      OutlinedButton(onClick = { onSelected(id) }, modifier = Modifier.weight(1f), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 6.dp)) {
        Text(label, fontSize = 10.sp, maxLines = 1)
      }
    }
  }
}

@Composable
private fun BacklogGroupHeading(title: String, count: Int) = Row(
  Modifier.fillMaxWidth().padding(top = 6.dp),
  verticalAlignment = Alignment.CenterVertically,
) {
  Text(title.uppercase(), color = FaroSoftBlue, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
  Spacer(Modifier.width(8.dp))
  Text(count.toString(), color = FaroMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
}

@Composable
private fun AgendaScreen(state: FaroUiState, onUpdate: (CalendarEntry) -> Unit, onDelete: (String) -> Unit, onQuick: () -> Unit) {
  var editing by remember { mutableStateOf<CalendarEntry?>(null) }
  var selectedDate by rememberSaveable { mutableStateOf(LocalDate.now().toString()) }
  val selected = runCatching { LocalDate.parse(selectedDate) }.getOrDefault(LocalDate.now())
  val weekStart = selected.with(DayOfWeek.MONDAY)
  val eventsByDay = state.events.groupBy { it.startsAt.eventDate() }
  LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    item { ScreenHeading("Agenda", "FARO Calendar escribe; Google es solo lectura", onQuick, "Nuevo evento") }
    item { AgendaWeekStrip(selected, weekStart, eventsByDay.keys, onSelect = { selectedDate = it.toString() }) }
    item { Text("AGENDA", color = FaroMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold) }
    val scheduled = state.events.filter { it.startsAt.eventDate()?.let { date -> date >= weekStart } == true }.take(24)
    items(scheduled, key = { it.id }) { event -> AgendaScheduleCard(event, onEdit = { editing = it }, onDelete) }
    if (state.events.isEmpty()) item { EmptyState("No hay eventos próximos.") }
  }
  editing?.let { event -> EventEditSheet(event, onDismiss = { editing = null }, onSave = { onUpdate(it); editing = null }) }
}

@Composable
private fun AgendaWeekStrip(selected: LocalDate, weekStart: LocalDate, eventDays: Set<LocalDate?>, onSelect: (LocalDate) -> Unit) = SectionCard("${selected.month.getDisplayName(TextStyle.FULL, Locale("es", "MX")).uppercase()} · CALENDARIO") {
  Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
    (0..6).map { weekStart.plusDays(it.toLong()) }.forEach { date ->
      val chosen = date == selected
      val hasEvent = eventDays.contains(date)
      Column(Modifier.clip(RoundedCornerShape(14.dp)).clickable { onSelect(date) }.padding(vertical = 7.dp, horizontal = 5.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(date.dayOfWeek.getDisplayName(TextStyle.NARROW, Locale("es", "MX")).uppercase(), color = if (chosen) FaroSoftBlue else FaroMuted, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(5.dp))
        Box(Modifier.size(30.dp).clip(CircleShape).background(if (chosen) FaroBlue else Color.Transparent), contentAlignment = Alignment.Center) { Text(date.dayOfMonth.toString(), color = FaroText, fontWeight = FontWeight.Bold, fontSize = 13.sp) }
        Spacer(Modifier.height(4.dp))
        Box(Modifier.size(4.dp).clip(CircleShape).background(if (hasEvent) FaroBlue else Color.Transparent))
      }
    }
  }
}

@Composable
private fun AgendaScheduleCard(event: CalendarEntry, onEdit: (CalendarEntry) -> Unit, onDelete: (String) -> Unit) = Card(colors = CardDefaults.cardColors(containerColor = FaroSurface), border = androidx.compose.foundation.BorderStroke(1.dp, FaroLine)) {
  Row(Modifier.fillMaxWidth().padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
    Column(Modifier.width(54.dp)) { Text(event.startsAt.eventTime(), color = FaroSoftBlue, fontWeight = FontWeight.Bold); Text(event.startsAt.eventDate()?.dayOfMonth?.toString() ?: "", color = FaroMuted, fontSize = 11.sp) }
    Box(Modifier.width(3.dp).height(44.dp).background(if (event.kind == "google") Color(0xFFEE7A63) else FaroBlue, RoundedCornerShape(4.dp)))
    Spacer(Modifier.width(11.dp))
    Column(Modifier.weight(1f)) { Text(event.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis); Text(if (event.kind == "google") "Google · solo lectura" else "FARO Calendar", color = FaroMuted, fontSize = 11.sp) }
    if (event.kind != "google") { IconButton(onClick = { onEdit(event) }) { Icon(Icons.Default.Edit, "Editar evento", tint = FaroSoftBlue) }; IconButton(onClick = { onDelete(event.id) }) { Icon(Icons.Default.Close, "Eliminar evento", tint = FaroMuted) } }
  }
}

@Composable
private fun VoiceScreen(state: FaroUiState, vm: FaroViewModel) {
  val context = LocalContext.current
  val view = LocalView.current
  var transcript by rememberSaveable { mutableStateOf("") }
  var listening by remember { mutableStateOf(false) }
  var speechError by remember { mutableStateOf<String?>(null) }
  val tts = remember { TextToSpeech(context) { } }
  val recognizer = remember {
    SpeechRecognizer.createSpeechRecognizer(context).apply {
      setRecognitionListener(object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) { listening = true }
        override fun onBeginningOfSpeech() = Unit
        override fun onRmsChanged(rmsdB: Float) = Unit
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() { listening = false }
        override fun onError(error: Int) { listening = false; speechError = "No pude escuchar con claridad. Intenta de nuevo." }
        override fun onResults(results: Bundle?) {
          listening = false
          val phrase = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
          if (phrase.isNotBlank()) { transcript = phrase; vm.sendVoice(phrase) }
        }
        override fun onPartialResults(partialResults: Bundle?) = Unit
        override fun onEvent(eventType: Int, params: Bundle?) = Unit
      })
    }
  }
  DisposableEffect(Unit) { onDispose { recognizer.destroy(); tts.stop(); tts.shutdown() } }
  val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    if (granted) startSpeech(recognizer) else speechError = "Permite el micrófono para usar FARO Voice."
  }
  LaunchedEffect(state.voice?.message) {
    state.voice?.message?.takeIf { it.isNotBlank() }?.let {
      tts.speak(it, TextToSpeech.QUEUE_FLUSH, null, "faro-response")
      view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
    }
  }
  LazyColumn(
    modifier = Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp),
  ) {
    item {
      Text("FARO VOICE", color = FaroBlue, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
      Spacer(Modifier.height(16.dp)); FaroOrb(150.dp, active = listening || state.loading)
      Spacer(Modifier.height(18.dp))
      Text(if (listening) "Te escucho…" else "Di o escribe lo que necesitas", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    }
    item {
      OutlinedTextField(transcript, { transcript = it }, Modifier.fillMaxWidth(), label = { Text("Tu instrucción") }, minLines = 3)
    }
    item {
      Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Button(onClick = {
          if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startSpeech(recognizer) else permission.launch(Manifest.permission.RECORD_AUDIO)
          view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
        }, colors = ButtonDefaults.buttonColors(containerColor = if (listening) FaroRed else FaroBlue)) { Icon(Icons.Default.KeyboardVoice, "Micrófono"); Spacer(Modifier.width(8.dp)); Text(if (listening) "Escuchando" else "Hablar") }
        OutlinedButton(onClick = { if (transcript.isNotBlank()) vm.sendVoice(transcript) }, enabled = transcript.isNotBlank() && !state.loading) { Icon(Icons.Default.PlayArrow, "Enviar"); Text("Enviar") }
      }
    }
    item { speechError?.let { Text(it, color = FaroRed, textAlign = TextAlign.Center) } }
    item {
      state.voice?.let { response ->
        SectionCard("RESPUESTA DE FARO") {
          Text(response.message, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Medium)
          response.qa?.let { Text(listOfNotNull(it.skill, it.route, it.provider).joinToString(" · "), color = FaroMuted, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp)) }
        }
      }
    }
    item {
      state.pendingAction?.let { action ->
        Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF10213B)), border = androidx.compose.foundation.BorderStroke(1.dp, FaroBlue)) {
          Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("CONFIRMA ANTES DE GUARDAR", color = FaroSoftBlue, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            Text(action.summary, fontWeight = FontWeight.Bold)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
              Button(onClick = vm::confirmVoice) { Icon(Icons.Default.Check, "Confirmar"); Text("Confirmar") }
              OutlinedButton(onClick = vm::cancelVoice) { Text("Cancelar") }
            }
          }
        }
      }
    }
  }
}

private fun startSpeech(recognizer: SpeechRecognizer) {
  recognizer.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
    putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-MX")
    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
  })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ExpenseSheet(state: FaroUiState, onDismiss: () -> Unit, onSave: (ExpenseDraft) -> Unit) {
  var amount by remember { mutableStateOf("") }; var description by remember { mutableStateOf("") }
  var accountId by remember { mutableStateOf(state.accounts.firstOrNull()?.id.orEmpty()) }
  var categoryId by remember { mutableStateOf(state.categories.firstOrNull { it.type == "expense" }?.id.orEmpty()) }
  var type by remember { mutableStateOf("expense") }
  var date by remember { mutableStateOf(LocalDate.now().toString()) }
  FormSheet("Registrar gasto", onDismiss) {
    Selector("Tipo", listOf("expense" to "Gasto", "income" to "Ingreso"), type, {
      type = it
      categoryId = state.categories.firstOrNull { category -> category.type == it }?.id.orEmpty()
    })
    Selector("Cuenta", state.accounts.map { it.id to it.name }, accountId, { accountId = it })
    Selector("Categoría", state.categories.filter { it.type == type }.map { it.id to it.name }, categoryId, { categoryId = it })
    OutlinedTextField(amount, { amount = it }, Modifier.fillMaxWidth(), label = { Text("Monto") }, singleLine = true)
    OutlinedTextField(description, { description = it }, Modifier.fillMaxWidth(), label = { Text("Descripción") })
    OutlinedTextField(date, { date = it }, Modifier.fillMaxWidth(), label = { Text("Fecha (AAAA-MM-DD)") }, singleLine = true)
    Button(onClick = { onSave(ExpenseDraft(amount.toDoubleOrNull() ?: 0.0, accountId, categoryId, description, date, type)) }, modifier = Modifier.fillMaxWidth()) { Text(if (type == "income") "Guardar ingreso" else "Guardar gasto") }
  }
}

/**
 * The mobile expense gadget deliberately keeps the default to an expense on
 * today's date. The complete form remains available for planned movements,
 * incomes, or a different date.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun QuickExpenseSheet(
  state: FaroUiState,
  onDismiss: () -> Unit,
  onMoreDetails: () -> Unit,
  onSave: (ExpenseDraft) -> Unit,
) {
  var amount by remember { mutableStateOf("") }
  var description by remember { mutableStateOf("") }
  var accountId by remember(state.accounts) { mutableStateOf(state.accounts.firstOrNull()?.id.orEmpty()) }
  var categoryId by remember(state.categories) { mutableStateOf(state.categories.firstOrNull { it.type == "expense" }?.id.orEmpty()) }
  val expenseCategories = state.categories.filter { it.type == "expense" }
  val validAmount = amount.replace(',', '.').toDoubleOrNull()
  val canSave = validAmount != null && validAmount > 0 && description.trim().isNotEmpty() && accountId.isNotBlank() && categoryId.isNotBlank()

  FormSheet("Gasto rápido", onDismiss) {
    Text("Se registrará como gasto de hoy y actualizará tu disponible al momento.", color = FaroMuted, fontSize = 12.sp)
    OutlinedTextField(
      value = amount,
      onValueChange = { amount = it },
      modifier = Modifier.fillMaxWidth(),
      label = { Text("¿Cuánto gastaste?") },
      prefix = { Text("$") },
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
      singleLine = true,
    )
    OutlinedTextField(
      value = description,
      onValueChange = { description = it },
      modifier = Modifier.fillMaxWidth(),
      label = { Text("¿En qué lo usaste?") },
      singleLine = true,
    )
    Selector("Desde qué cuenta", state.accounts.map { it.id to it.name }, accountId, { accountId = it })
    Selector("Categoría", expenseCategories.map { it.id to it.name }, categoryId, { categoryId = it })
    Button(
      onClick = { onSave(ExpenseDraft(validAmount ?: 0.0, accountId, categoryId, description, LocalDate.now().toString())) },
      enabled = canSave,
      modifier = Modifier.fillMaxWidth(),
    ) { Text(if (validAmount == null) "Registrar gasto" else "Registrar ${money(validAmount)}") }
    TextButton(onClick = onMoreDetails, modifier = Modifier.fillMaxWidth()) { Text("Agregar fecha, ingreso u otros detalles") }
  }
}

/** Review-only import surface opened when a bank app shares a receipt with FARO. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReceiptImportSheet(receipt: SharedReceipt, state: FaroUiState, onDismiss: () -> Unit, onSave: (ExpenseDraft) -> Unit) {
  val context = LocalContext.current
  var analysis by remember(receipt.key) { mutableStateOf(ReceiptAnalysis(sourceLabel = receipt.displayName)) }
  var analyzing by remember(receipt.key) { mutableStateOf(true) }
  var amount by remember(receipt.key) { mutableStateOf("") }
  var description by remember(receipt.key) { mutableStateOf("Transferencia bancaria") }
  var date by remember(receipt.key) { mutableStateOf(LocalDate.now().toString()) }
  var accountId by remember(receipt.key) { mutableStateOf(state.accounts.firstOrNull()?.id.orEmpty()) }
  var categoryId by remember(receipt.key) { mutableStateOf(state.categories.firstOrNull { it.type == "expense" }?.id.orEmpty()) }
  var showDetails by remember(receipt.key) { mutableStateOf(false) }

  LaunchedEffect(receipt.key) {
    analyzing = true
    analysis = runCatching { ReceiptExtractor.analyze(context, receipt) }
      .getOrElse { ReceiptTextParser.parse(receipt.displayName, "") }
    amount = analysis.amount?.let { String.format(Locale.US, "%.2f", it) }.orEmpty()
    description = analysis.description
    date = analysis.date
    analyzing = false
  }
  LaunchedEffect(analysis.bank, state.accounts, state.categories) {
    if (state.accounts.none { it.id == accountId }) {
      val bankAccount = state.accounts.firstOrNull { account -> analysis.bank.accountWords.any { word -> account.name.contains(word, ignoreCase = true) } }
      accountId = (bankAccount ?: state.accounts.firstOrNull())?.id.orEmpty()
    }
    if (state.categories.none { it.id == categoryId && it.type == "expense" }) {
      categoryId = state.categories.firstOrNull { it.type == "expense" }?.id.orEmpty()
    }
  }

  val validAmount = ReceiptTextParser.parseAmount(amount) ?: amount.replace(',', '.').toDoubleOrNull()
  val canSave = !analyzing && validAmount != null && accountId.isNotBlank() && categoryId.isNotBlank() && description.isNotBlank()
  val accountName = state.accounts.firstOrNull { it.id == accountId }?.name ?: "Cuenta por elegir"
  val categoryName = state.categories.firstOrNull { it.id == categoryId }?.name ?: "Categoría por elegir"
  FormSheet("Registrar comprobante", onDismiss) {
    Text("Comprobante recibido", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
    Text("${analysis.bank.label} ${if (analysis.bank.accountWords.isNotEmpty()) "detectado" else "por confirmar"} · ${analysis.sourceLabel}", color = FaroSoftBlue, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    if (analyzing) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
        Text("Leyendo el comprobante en este teléfono…", color = FaroMuted, fontSize = 12.sp)
      }
    } else if (!showDetails && canSave) {
      Card(colors = CardDefaults.cardColors(containerColor = FaroSurface), border = androidx.compose.foundation.BorderStroke(1.dp, FaroLine)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
          Text("LISTO PARA REGISTRAR", color = FaroSoftBlue, fontSize = 10.sp, fontWeight = FontWeight.Bold)
          Text(money(validAmount ?: 0.0), fontWeight = FontWeight.Black, fontSize = 28.sp)
          Text("$description · $date", color = FaroText, fontSize = 13.sp)
          Text("$accountName · $categoryName", color = FaroMuted, fontSize = 12.sp)
        }
      }
      Button(
        onClick = { onSave(ExpenseDraft(validAmount ?: 0.0, accountId, categoryId, description, date)) },
        modifier = Modifier.fillMaxWidth(),
      ) { Text("Registrar gasto de ${money(validAmount ?: 0.0)}") }
      TextButton(onClick = { showDetails = true }, modifier = Modifier.fillMaxWidth()) { Text("Revisar o cambiar datos") }
    } else {
      Text(
        if (analysis.rawTextAvailable && analysis.amount != null) "Monto, fecha y destinatario detectados localmente. Revísalos antes de registrar."
        else "No pude confirmar todos los datos. Completa o corrige los campos antes de guardar.",
        color = FaroMuted,
        fontSize = 12.sp,
      )
      Selector("Cuenta de salida", state.accounts.map { it.id to it.name }, accountId, { accountId = it })
      Selector("Categoría", state.categories.filter { it.type == "expense" }.map { it.id to it.name }, categoryId, { categoryId = it })
      OutlinedTextField(amount, { amount = it }, Modifier.fillMaxWidth(), label = { Text("Monto transferido") }, singleLine = true)
      OutlinedTextField(description, { description = it }, Modifier.fillMaxWidth(), label = { Text("Descripción") })
      OutlinedTextField(date, { date = it }, Modifier.fillMaxWidth(), label = { Text("Fecha (AAAA-MM-DD)") }, singleLine = true)
      Text("FARO no registra nada hasta que confirmes. El archivo se usa solo para extraer estos datos y no se adjunta ni se sube en esta primera versión.", color = FaroMuted, fontSize = 11.sp, lineHeight = 15.sp)
      Button(
        enabled = canSave,
        onClick = { onSave(ExpenseDraft(validAmount ?: 0.0, accountId, categoryId, description, date)) },
        modifier = Modifier.fillMaxWidth(),
      ) { Text("Confirmar gasto") }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TaskSheet(state: FaroUiState, onDismiss: () -> Unit, onSave: (TaskDraft) -> Unit) {
  var title by remember { mutableStateOf("") }; var description by remember { mutableStateOf("") }
  var workspaceId by remember { mutableStateOf(state.workspaces.firstOrNull()?.id.orEmpty()) }
  var priority by remember { mutableStateOf("medium") }; var duration by remember { mutableStateOf("") }; var dueAt by remember { mutableStateOf("") }
  FormSheet("Nueva tarea", onDismiss) {
    OutlinedTextField(title, { title = it }, Modifier.fillMaxWidth(), label = { Text("Título") })
    OutlinedTextField(description, { description = it }, Modifier.fillMaxWidth(), label = { Text("Descripción") })
    Selector("Workspace", state.workspaces.map { it.id to it.name }, workspaceId, { workspaceId = it })
    Selector("Prioridad", listOf("low" to "Baja", "medium" to "Media", "high" to "Alta", "critical" to "Crítica"), priority, { priority = it })
    OutlinedTextField(dueAt, { dueAt = it }, Modifier.fillMaxWidth(), label = { Text("Fecha objetivo ISO 8601 (opcional)") }, singleLine = true)
    OutlinedTextField(duration, { duration = it }, Modifier.fillMaxWidth(), label = { Text("Duración estimada (minutos)") }, singleLine = true)
    Button(onClick = { onSave(TaskDraft(title, workspaceId.ifBlank { null }, description, priority, dueAt.ifBlank { null }, duration.toIntOrNull())) }, modifier = Modifier.fillMaxWidth()) { Text("Crear tarea") }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EventSheet(state: FaroUiState, onDismiss: () -> Unit, onSave: (EventDraft) -> Unit) {
  val now = remember { OffsetDateTime.now(ZoneOffset.UTC).withMinute(0).withSecond(0).withNano(0) }
  var title by remember { mutableStateOf("") }; var description by remember { mutableStateOf("") }
  var start by remember { mutableStateOf(now.toString()) }; var end by remember { mutableStateOf(now.plusHours(1).toString()) }
  var workspaceId by remember { mutableStateOf(state.workspaces.firstOrNull()?.id.orEmpty()) }
  FormSheet("Nuevo evento FARO", onDismiss) {
    OutlinedTextField(title, { title = it }, Modifier.fillMaxWidth(), label = { Text("Título") })
    OutlinedTextField(start, { start = it }, Modifier.fillMaxWidth(), label = { Text("Inicio ISO 8601") })
    OutlinedTextField(end, { end = it }, Modifier.fillMaxWidth(), label = { Text("Fin ISO 8601") })
    OutlinedTextField(description, { description = it }, Modifier.fillMaxWidth(), label = { Text("Descripción") })
    Selector("Workspace", state.workspaces.map { it.id to it.name }, workspaceId, { workspaceId = it })
    Button(onClick = { onSave(EventDraft(title, start, end, workspaceId.ifBlank { null }, description)) }, modifier = Modifier.fillMaxWidth()) { Text("Crear evento") }
    Text("Google Calendar se muestra como solo lectura.", color = FaroMuted, fontSize = 12.sp)
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun VoiceQuickSheet(onDismiss: () -> Unit, onOpenVoice: () -> Unit) = ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState()) {
  Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
    FaroOrb(78.dp); Spacer(Modifier.height(12.dp)); Text("Hablar con FARO", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
    Text("Usa las mismas skills, confirmaciones y observabilidad de FARO Voice.", color = FaroMuted, textAlign = TextAlign.Center, modifier = Modifier.padding(vertical = 10.dp))
    Button(onClick = onOpenVoice, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Default.KeyboardVoice, null); Text("Abrir Voice") }
    Spacer(Modifier.height(18.dp))
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FormSheet(title: String, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) = ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState()) {
  Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
    Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
    content()
    Spacer(Modifier.height(18.dp))
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TransactionEditSheet(current: FinanceTransaction, state: FaroUiState, onDismiss: () -> Unit, onSave: (FinanceTransaction) -> Unit) {
  var amount by remember { mutableStateOf(current.amount.toString()) }
  var description by remember { mutableStateOf(current.description) }
  var date by remember { mutableStateOf(current.transactionDate) }
  var accountId by remember { mutableStateOf(current.accountId) }
  var categoryId by remember { mutableStateOf(current.categoryId.orEmpty()) }
  FormSheet("Editar movimiento", onDismiss) {
    Selector("Cuenta", state.accounts.map { it.id to it.name }, accountId, { accountId = it })
    Selector("Categoría", state.categories.filter { it.type == current.type }.map { it.id to it.name }, categoryId, { categoryId = it })
    OutlinedTextField(amount, { amount = it }, Modifier.fillMaxWidth(), label = { Text("Monto") }, singleLine = true)
    OutlinedTextField(description, { description = it }, Modifier.fillMaxWidth(), label = { Text("Descripción") })
    OutlinedTextField(date, { date = it }, Modifier.fillMaxWidth(), label = { Text("Fecha (AAAA-MM-DD)") }, singleLine = true)
    Button(onClick = {
      onSave(current.copy(amount = amount.toDoubleOrNull() ?: current.amount, description = description, transactionDate = date, accountId = accountId, categoryId = categoryId.ifBlank { null }))
    }, modifier = Modifier.fillMaxWidth()) { Text("Guardar cambios") }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TaskEditSheet(current: FaroTask, state: FaroUiState, onDismiss: () -> Unit, onSave: (FaroTask) -> Unit) {
  var title by remember { mutableStateOf(current.title) }; var description by remember { mutableStateOf(current.description.orEmpty()) }
  var workspaceId by remember { mutableStateOf(current.workspaceId.orEmpty()) }; var priority by remember { mutableStateOf(current.priority) }
  var status by remember { mutableStateOf(current.status) }; var dueAt by remember { mutableStateOf(current.dueAt.orEmpty()) }
  var duration by remember { mutableStateOf(current.estimatedMinutes?.toString().orEmpty()) }
  FormSheet("Editar tarea", onDismiss) {
    OutlinedTextField(title, { title = it }, Modifier.fillMaxWidth(), label = { Text("Título") })
    OutlinedTextField(description, { description = it }, Modifier.fillMaxWidth(), label = { Text("Descripción") })
    Selector("Estado", listOf("todo" to "Pendiente", "doing" to "En progreso", "blocked" to "Bloqueado", "done" to "Completada"), status, { status = it })
    Selector("Workspace", state.workspaces.map { it.id to it.name }, workspaceId, { workspaceId = it })
    Selector("Prioridad", listOf("low" to "Baja", "medium" to "Media", "high" to "Alta", "critical" to "Crítica"), priority, { priority = it })
    OutlinedTextField(dueAt, { dueAt = it }, Modifier.fillMaxWidth(), label = { Text("Fecha objetivo ISO 8601 (opcional)") }, singleLine = true)
    OutlinedTextField(duration, { duration = it }, Modifier.fillMaxWidth(), label = { Text("Duración estimada (minutos)") }, singleLine = true)
    Button(onClick = {
      onSave(current.copy(title = title, description = description, status = status, workspaceId = workspaceId.ifBlank { null }, priority = priority, dueAt = dueAt.ifBlank { null }, estimatedMinutes = duration.toIntOrNull()))
    }, modifier = Modifier.fillMaxWidth()) { Text("Guardar cambios") }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EventEditSheet(current: CalendarEntry, onDismiss: () -> Unit, onSave: (CalendarEntry) -> Unit) {
  var title by remember { mutableStateOf(current.title) }; var description by remember { mutableStateOf(current.description.orEmpty()) }
  var start by remember { mutableStateOf(current.startsAt) }; var end by remember { mutableStateOf(current.endsAt) }
  FormSheet("Editar evento FARO", onDismiss) {
    OutlinedTextField(title, { title = it }, Modifier.fillMaxWidth(), label = { Text("Título") })
    OutlinedTextField(start, { start = it }, Modifier.fillMaxWidth(), label = { Text("Inicio ISO 8601") })
    OutlinedTextField(end, { end = it }, Modifier.fillMaxWidth(), label = { Text("Fin ISO 8601") })
    OutlinedTextField(description, { description = it }, Modifier.fillMaxWidth(), label = { Text("Descripción") })
    Button(onClick = { onSave(current.copy(title = title, description = description, startsAt = start, endsAt = end)) }, modifier = Modifier.fillMaxWidth()) { Text("Guardar y mover evento") }
  }
}

@Composable
private fun Selector(label: String, options: List<Pair<String, String>>, selected: String, onSelected: (String) -> Unit) {
  var expanded by remember { mutableStateOf(false) }
  Column {
    Text(label, color = FaroMuted, fontSize = 12.sp)
    Text((options.firstOrNull { it.first == selected }?.second ?: "Selecciona"), modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.dp, FaroLine, RoundedCornerShape(12.dp)).clickable { expanded = true }.padding(14.dp))
    androidx.compose.material3.DropdownMenu(expanded, { expanded = false }) { options.forEach { (id, name) -> androidx.compose.material3.DropdownMenuItem(text = { Text(name) }, onClick = { onSelected(id); expanded = false }) } }
  }
}

@Composable
private fun ScreenHeading(title: String, subtitle: String, onQuick: () -> Unit, action: String) = Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
  Column(Modifier.weight(1f)) { Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Black); Text(subtitle, color = FaroMuted, fontSize = 13.sp) }
  OutlinedButton(onClick = onQuick) { Icon(Icons.Default.Add, null); Text(action, fontSize = 11.sp) }
}

@Composable
private fun MetricCard(label: String, value: String, footnote: String) = Card(colors = CardDefaults.cardColors(containerColor = FaroSurface), border = androidx.compose.foundation.BorderStroke(1.dp, FaroLine)) {
  Column(Modifier.fillMaxWidth().padding(18.dp)) { Text(label, color = FaroMuted); Text(value, fontSize = 30.sp, fontWeight = FontWeight.Bold); Text(footnote, color = FaroMuted, fontSize = 12.sp) }
}

@Composable
private fun SectionCard(title: String, content: @Composable ColumnScope.() -> Unit) = Card(colors = CardDefaults.cardColors(containerColor = FaroSurface), border = androidx.compose.foundation.BorderStroke(1.dp, FaroLine)) {
  Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { Text(title.uppercase(), color = FaroSoftBlue, fontWeight = FontWeight.Bold, fontSize = 12.sp); content() }
}

@Composable
private fun TransactionLine(item: FinanceTransaction, onEdit: (FinanceTransaction) -> Unit, onDelete: (String) -> Unit) = Card(colors = CardDefaults.cardColors(containerColor = FaroSurface), border = androidx.compose.foundation.BorderStroke(1.dp, FaroLine)) {
  Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
    Column(Modifier.weight(1f)) { Text(item.description, fontWeight = FontWeight.Bold); Text("${item.transactionDate} · ${item.status}", color = FaroMuted, fontSize = 12.sp) }
    Text((if (item.type == "income") "+" else "−") + money(item.amount), color = if (item.type == "income") Color(0xFF42D6A4) else FaroText, fontWeight = FontWeight.Bold)
    IconButton(onClick = { onEdit(item) }) { Icon(Icons.Default.Edit, "Editar movimiento", tint = FaroSoftBlue) }
    IconButton(onClick = { onDelete(item.id) }) { Icon(Icons.Default.Close, "Eliminar", tint = FaroMuted) }
  }
}

@Composable
private fun TaskLine(task: FaroTask) { Text(task.title, fontWeight = FontWeight.SemiBold); Text(task.dueAt?.localLabel() ?: task.priority, color = FaroMuted, fontSize = 12.sp) }

@Composable
private fun TaskCard(task: FaroTask, onEdit: (FaroTask) -> Unit, onStatus: (FaroTask, String) -> Unit, onDelete: (String) -> Unit) = Card(
  colors = CardDefaults.cardColors(containerColor = if (task.status == "blocked") Color(0xFF241117) else FaroSurface),
  border = androidx.compose.foundation.BorderStroke(1.dp, if (task.status == "doing") FaroBlue else FaroLine),
) {
  Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
    Box(
      Modifier.size(9.dp).clip(CircleShape).background(
        when (task.status) {
          "doing" -> FaroBlue
          "blocked" -> FaroRed
          "done" -> Color(0xFF42D6A4)
          else -> FaroMuted
        },
      ),
    )
    Spacer(Modifier.width(11.dp))
    Column(Modifier.weight(1f)) {
      Text(task.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
      Text("${task.priority.label()} · ${task.estimatedMinutes?.let { "$it min" } ?: "sin duración"}${task.dueAt?.let { " · ${it.eventDate() ?: it}" } ?: ""}", color = FaroMuted, fontSize = 12.sp)
    }
    IconButton(onClick = { onStatus(task, if (task.status == "done") "todo" else "done") }) { Icon(Icons.Default.Check, "Cambiar estado", tint = FaroBlue) }
    IconButton(onClick = { onEdit(task) }) { Icon(Icons.Default.Edit, "Editar tarea", tint = FaroSoftBlue) }
    IconButton(onClick = { onDelete(task.id) }) { Icon(Icons.Default.Close, "Eliminar", tint = FaroMuted) }
  }
}

@Composable
private fun EventCard(event: CalendarEntry, onEdit: (CalendarEntry) -> Unit, onDelete: (String) -> Unit) = Card(colors = CardDefaults.cardColors(containerColor = FaroSurface), border = androidx.compose.foundation.BorderStroke(1.dp, FaroLine)) {
  Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
    Column(Modifier.weight(1f)) { Text(event.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis); Text("${event.startsAt.localLabel()} · ${if (event.kind == "google") "Google · solo lectura" else "FARO"}", color = FaroMuted, fontSize = 12.sp) }
    if (event.kind != "google") {
      IconButton(onClick = { onEdit(event) }) { Icon(Icons.Default.Edit, "Editar evento", tint = FaroSoftBlue) }
      IconButton(onClick = { onDelete(event.id) }) { Icon(Icons.Default.Close, "Eliminar evento", tint = FaroMuted) }
    }
  }
}

@Composable
private fun EmptyState(text: String) = Text(text, color = FaroMuted, modifier = Modifier.fillMaxWidth().padding(24.dp), textAlign = TextAlign.Center)

@Composable
private fun FaroOrb(size: androidx.compose.ui.unit.Dp, active: Boolean = false) {
  val context = LocalContext.current
  val orb = remember {
    context.assets.open("faro-orb-v1.png").use { stream -> BitmapFactory.decodeStream(stream).asImageBitmap() }
  }
  Box(
    modifier = Modifier.size(size).clip(CircleShape).border(if (active) 2.dp else 1.dp, if (active) FaroBlue else FaroLine, CircleShape),
    contentAlignment = Alignment.Center,
  ) {
    Image(orb, contentDescription = "Orbe de FARO", modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
    if (active) CircularProgressIndicator(modifier = Modifier.fillMaxSize().padding(4.dp), color = FaroSoftBlue, strokeWidth = 1.5.dp)
  }
}

private fun money(value: Double) = "$" + String.format(Locale.US, "%,.2f", value)
private fun String.label() = when (this) {
  "critical" -> "Crítica"
  "high" -> "Alta"
  "low" -> "Baja"
  else -> "Media"
}
private fun completedDateLabel(date: LocalDate?): String = when (date) {
  null -> "Cerradas sin fecha"
  LocalDate.now() -> "Cerradas hoy"
  LocalDate.now().minusDays(1) -> "Cerradas ayer"
  else -> "Cerradas el ${date.dayOfWeek.getDisplayName(TextStyle.FULL, Locale("es", "MX"))} ${date.dayOfMonth} de ${date.month.getDisplayName(TextStyle.FULL, Locale("es", "MX"))}"
}
private fun String.localLabel(): String = runCatching { OffsetDateTime.parse(this).toLocalDateTime().toString().replace('T', ' ') }.getOrDefault(this)
private fun String.localTime(): String = runCatching { OffsetDateTime.parse(this).toLocalTime().toString().take(5) }.getOrDefault(this)
private fun String.eventDate(): LocalDate? = runCatching { OffsetDateTime.parse(this).toLocalDate() }
  .recoverCatching { LocalDate.parse(this.take(10)) }.getOrNull()
private fun String.eventTime(): String = runCatching { OffsetDateTime.parse(this).toLocalTime().toString().take(5) }
  .getOrElse { substringAfter('T', substringAfter(' ', "Todo el día")).take(5).ifBlank { "Todo el día" } }

@Composable
private fun FaroTheme(content: @Composable () -> Unit) = MaterialTheme(
  colorScheme = androidx.compose.material3.darkColorScheme(primary = FaroBlue, onPrimary = FaroText, background = FaroBlack, surface = FaroSurface, onSurface = FaroText, outline = FaroLine, error = FaroRed),
  content = content,
)
