package com.mar3ksoftware.private_chat_mobile

import android.content.Intent
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "private_chat/media")
            .setMethodCallHandler { call, result ->
                if (call.method == "openFile") {
                    val path = call.argument<String>("path")
                    val mime = call.argument<String>("mime")
                    if (path == null || mime == null) {
                        result.success(false)
                        return@setMethodCallHandler
                    }
                    val opened = try {
                        val uri = FileProvider.getUriForFile(
                            this,
                            "$packageName.fileprovider",
                            File(path)
                        )
                        val intent = Intent(Intent.ACTION_VIEW)
                            .setDataAndType(uri, mime)
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        startActivity(intent)
                        true
                    } catch (e: Exception) {
                        false
                    }
                    result.success(opened)
                } else {
                    result.notImplemented()
                }
            }
    }
}
