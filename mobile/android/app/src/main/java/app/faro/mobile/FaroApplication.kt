package app.faro.mobile

import android.app.Application
import app.faro.mobile.data.FaroRepository
import app.faro.mobile.data.SessionStore
import app.faro.mobile.data.SupabaseApi

class FaroApplication : Application() {
  val repository by lazy { FaroRepository(SupabaseApi(SessionStore(this))) }
}
