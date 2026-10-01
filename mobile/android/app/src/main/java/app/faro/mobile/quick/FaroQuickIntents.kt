package app.faro.mobile.quick

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import app.faro.mobile.MainActivity
import app.faro.mobile.navigation.FaroDeepLinks
import app.faro.mobile.navigation.QuickAction

object FaroQuickIntents {
  fun intent(context: Context, action: QuickAction): Intent = Intent(context, MainActivity::class.java).apply {
    this.action = Intent.ACTION_VIEW
    data = FaroDeepLinks.uriFor(action)
    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
  }

  fun activity(context: Context, action: QuickAction, requestCode: Int): PendingIntent = PendingIntent.getActivity(
    context,
    requestCode,
    intent(context, action),
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
  )
}
