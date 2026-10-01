package app.faro.mobile.navigation

import android.net.Uri

/**
 * Destinations are an enum rather than arbitrary objects so Compose can persist
 * the selected tab through Android's saved-state Bundle (including Quick Boot).
 */
enum class FaroDestination {
  Home,
  Finance,
  Voice,
  Agenda,
  Backlog,
}

enum class QuickAction { Expense, Task, Event, Voice }

data class FaroDeepLink(val destination: FaroDestination, val quickAction: QuickAction? = null)

object FaroDeepLinks {
  fun parse(uri: Uri?): FaroDeepLink = parse(uri?.toString())

  /** Pure-string parser so deep-link routing is unit-testable without an Android runtime. */
  fun parse(raw: String?): FaroDeepLink {
    val safe = raw.orEmpty().lowercase()
    if (!safe.startsWith("faro://")) return FaroDeepLink(FaroDestination.Home)
    return when (safe.removePrefix("faro://").substringBefore('/')) {
      "voice" -> FaroDeepLink(FaroDestination.Voice, QuickAction.Voice)
      "quick" -> when (safe.substringAfter("quick/", "").substringBefore('?')) {
        "gasto" -> FaroDeepLink(FaroDestination.Finance, QuickAction.Expense)
        "tarea" -> FaroDeepLink(FaroDestination.Backlog, QuickAction.Task)
        "evento" -> FaroDeepLink(FaroDestination.Agenda, QuickAction.Event)
        else -> FaroDeepLink(FaroDestination.Home)
      }
      else -> FaroDeepLink(FaroDestination.Home)
    }
  }

  fun uriFor(action: QuickAction): Uri = when (action) {
    QuickAction.Expense -> Uri.parse("faro://quick/gasto")
    QuickAction.Task -> Uri.parse("faro://quick/tarea")
    QuickAction.Event -> Uri.parse("faro://quick/evento")
    QuickAction.Voice -> Uri.parse("faro://voice")
  }
}
