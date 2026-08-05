package com.example.avault.ui

import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.common.Barcode
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import android.util.Size

@Composable
fun QrScanner(onResult: (String) -> Unit, onState: (String) -> Unit = {}, modifier: Modifier = Modifier) {
    val lifecycle = LocalLifecycleOwner.current
    val executor = androidx.compose.runtime.remember { Executors.newSingleThreadExecutor() }
    val scanner = androidx.compose.runtime.remember { BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()) }
    val handled = androidx.compose.runtime.remember { AtomicBoolean(false) }
    DisposableEffect(Unit) { onState("将二维码置于取景框内") ; onDispose { scanner.close(); executor.shutdown() } }
    AndroidView(factory = { context ->
        PreviewView(context).also { view ->
            view.scaleType = PreviewView.ScaleType.FILL_CENTER
            val provider = ProcessCameraProvider.getInstance(context)
            provider.addListener({
                val camera = provider.get()
                val preview = androidx.camera.core.Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }
                val analysis = ImageAnalysis.Builder().setTargetResolution(Size(1280, 720)).setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build().also { analyzer ->
                    analyzer.setAnalyzer(executor) { image ->
                        val mediaImage = image.image
                        if (mediaImage == null) { image.close(); return@setAnalyzer }
                        val input = com.google.mlkit.vision.common.InputImage.fromMediaImage(mediaImage, image.imageInfo.rotationDegrees)
                        scanner.process(input).addOnSuccessListener { codes ->
                            codes.firstOrNull()?.rawValue?.let { value ->
                                if (handled.compareAndSet(false, true)) { onState("已识别二维码，正在连接电脑…"); onResult(value) }
                            }
                        }.addOnFailureListener { onState("二维码识别失败，请调整距离后重试") }.addOnCompleteListener { image.close() }
                    }
                }
                camera.unbindAll(); camera.bindToLifecycle(lifecycle, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            }, ContextCompat.getMainExecutor(context))
        }
    }, modifier = modifier)
}
