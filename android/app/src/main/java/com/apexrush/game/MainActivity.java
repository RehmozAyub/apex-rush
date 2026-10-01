package com.apexrush.game;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.DisplayCutout;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

/**
 * APEX RUSH on Android: a full-screen WebView that serves the bundled game (assets/game) from
 * https://appassets.androidplatform.net, so ES modules and workers load like on the web and the
 * game runs offline. The page talks to the phone through window.ApexAndroid (see Bridge).
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private WebView web;
    private Vibrator vibrator;
    // display-cutout insets in CSS px, read by the page through Bridge.insets()
    private volatile String insets = "0,0,0,0";

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            // draw under the camera cutout; the HUD keeps clear of it using the insets
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        setContentView(web);
        hideSystemBars();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setUserAgentString(s.getUserAgentString() + " ApexRushAndroid");

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (HOST.equals(url.getHost())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, url)); // e.g. a link to the releases page
                return true;
            }
        });
        web.setOnApplyWindowInsetsListener((v, wi) -> {
            readInsets(wi);
            return v.onApplyWindowInsets(wi);
        });
        web.addJavascriptInterface(new Bridge(), "ApexAndroid");
        web.loadUrl("https://" + HOST + "/game/index.html");
    }

    private void readInsets(WindowInsets wi) {
        if (Build.VERSION.SDK_INT < 28 || wi == null) return;
        DisplayCutout c = wi.getDisplayCutout();
        float d = getResources().getDisplayMetrics().density;
        if (c == null) insets = "0,0,0,0";
        else insets = Math.round(c.getSafeInsetLeft() / d) + "," + Math.round(c.getSafeInsetTop() / d) + ","
                + Math.round(c.getSafeInsetRight() / d) + "," + Math.round(c.getSafeInsetBottom() / d);
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    // Back = the game's Esc (pause / previous screen). On the title screen the game says it did
    // not use it, and the app closes.
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("window.__apexBack ? window.__apexBack() : false", (handled) -> {
            if (!"true".equals(handled)) finish();
        });
    }

    @Override
    protected void onPause() {
        web.evaluateJavascript("window.__apexPause && window.__apexPause()", null);
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        hideSystemBars();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    /** window.ApexAndroid in the page. */
    private class Bridge {
        @JavascriptInterface
        public void vibrate(int ms, int strength) {
            if (vibrator == null || !vibrator.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= 26) {
                vibrator.vibrate(VibrationEffect.createOneShot(ms, Math.max(1, Math.min(255, strength))));
            } else {
                vibrator.vibrate(ms);
            }
        }

        @JavascriptInterface
        public String insets() {
            return insets;
        }

        @JavascriptInterface
        public void exit() {
            runOnUiThread(MainActivity.this::finish);
        }
    }
}
