package com.hanlinsoftware.heapgame.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.gms.games.PlayGames;
import com.google.android.gms.games.GamesSignInClient;
import com.google.android.gms.games.Player;

@CapacitorPlugin(name = "PlayGames")
public class PlayGamesPlugin extends Plugin {

    // ── Sign-in ──────────────────────────────────────────────────────────────

    @PluginMethod
    public void signIn(PluginCall call) {
        GamesSignInClient signInClient = PlayGames.getGamesSignInClient(getActivity());
        signInClient.isAuthenticated().addOnCompleteListener(authTask -> {
            boolean isAuthenticated = authTask.isSuccessful()
                && authTask.getResult() != null
                && authTask.getResult().isAuthenticated();

            if (isAuthenticated) {
                fetchAndResolvePlayer(call);
            } else {
                signInClient.signIn().addOnCompleteListener(signInTask -> {
                    if (signInTask.isSuccessful()) {
                        fetchAndResolvePlayer(call);
                    } else {
                        call.reject("GPGS sign-in failed");
                    }
                });
            }
        });
    }

    private void fetchAndResolvePlayer(PluginCall call) {
        PlayGames.getPlayersClient(getActivity()).getCurrentPlayer()
            .addOnCompleteListener(playerTask -> {
                if (playerTask.isSuccessful() && playerTask.getResult() != null) {
                    Player player = playerTask.getResult();
                    JSObject result = new JSObject();
                    result.put("playerId", player.getPlayerId());
                    result.put("displayName", player.getDisplayName());
                    call.resolve(result);
                } else {
                    call.reject("Failed to get player info");
                }
            });
    }
}
