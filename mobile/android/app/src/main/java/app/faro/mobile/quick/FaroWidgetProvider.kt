package app.faro.mobile.quick

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.widget.RemoteViews
import app.faro.mobile.R
import app.faro.mobile.navigation.QuickAction

class FaroWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
    appWidgetIds.forEach { id ->
      val views = RemoteViews(context.packageName, R.layout.faro_widget).apply {
        setOnClickPendingIntent(R.id.action_expense, FaroQuickIntents.activity(context, QuickAction.Expense, 10))
        setOnClickPendingIntent(R.id.action_task, FaroQuickIntents.activity(context, QuickAction.Task, 11))
        setOnClickPendingIntent(R.id.action_event, FaroQuickIntents.activity(context, QuickAction.Event, 12))
        setOnClickPendingIntent(R.id.action_voice, FaroQuickIntents.activity(context, QuickAction.Voice, 13))
      }
      manager.updateAppWidget(id, views)
    }
  }
}
