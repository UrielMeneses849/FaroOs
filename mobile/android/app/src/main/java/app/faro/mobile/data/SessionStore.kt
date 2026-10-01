package app.faro.mobile.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.serialization.json.Json

class SessionStore(context: Context) {
  private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
  private val prefs = EncryptedSharedPreferences.create(
    context,
    "faro.mobile.session",
    MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
  )

  fun read(): FaroSession? = prefs.getString(SESSION_KEY, null)?.let { raw ->
    runCatching { json.decodeFromString<FaroSession>(raw) }.getOrNull()
  }

  fun write(session: FaroSession) {
    prefs.edit().putString(SESSION_KEY, json.encodeToString(FaroSession.serializer(), session)).apply()
  }

  fun clear() = prefs.edit().remove(SESSION_KEY).apply()

  private companion object { const val SESSION_KEY = "supabase_session" }
}
