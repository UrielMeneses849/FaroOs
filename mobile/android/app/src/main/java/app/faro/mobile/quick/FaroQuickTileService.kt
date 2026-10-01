package app.faro.mobile.quick

import android.annotation.SuppressLint
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import app.faro.mobile.navigation.QuickAction

class FaroQuickTileService : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    qsTile?.apply { state = Tile.STATE_ACTIVE; label = "FARO"; updateTile() }
  }

  override fun onClick() {
    super.onClick()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startActivityAndCollapse(FaroQuickIntents.activity(this, QuickAction.Voice, 41))
    } else {
      startActivityAndCollapseBeforeAndroid14()
    }
  }

  @SuppressLint("StartActivityAndCollapseDeprecated")
  @Suppress("DEPRECATION")
  private fun startActivityAndCollapseBeforeAndroid14() {
    startActivityAndCollapse(FaroQuickIntents.intent(this, QuickAction.Voice))
  }
}
