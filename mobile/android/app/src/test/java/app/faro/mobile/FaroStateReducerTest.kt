package app.faro.mobile

import app.faro.mobile.ui.FaroStateReducer
import app.faro.mobile.ui.FaroUiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FaroStateReducerTest {
  @Test fun `view model state clears a prior error when a request begins`() {
    val started = FaroStateReducer.loading(FaroUiState(error = "offline"), true)
    assertTrue(started.loading)
    assertEquals(null, started.error)
  }

  @Test fun `view model state exposes a recoverable request error`() {
    val failed = FaroStateReducer.failed(FaroUiState(loading = true), "Sin conexión")
    assertFalse(failed.loading)
    assertEquals("Sin conexión", failed.error)
  }
}
