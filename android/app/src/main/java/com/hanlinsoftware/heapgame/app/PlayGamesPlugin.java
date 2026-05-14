package com.hanlinsoftware.heapgame.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.gms.games.PlayGames;
import com.google.android.gms.games.GamesSignInClient;
import com.google.android.gms.games.Player;
import com.google.android.gms.games.AchievementsClient;

@CapacitorPlugin(name = "PlayGames")
public class PlayGamesPlugin extends Plugin {

    // ── Sign-in ──────────────────────────────────────────────────────────────

    @PluginMethod
    public void signIn(PluginCall call) {
        GamesSignInClient signInClient = PlayGames.getGamesSignInClient(getActivity());
        signInClient.isAuthenticated().addOnCompleteListener(authTask -> {
            if (!authTask.isSuccessful()) {
                call.reject("Failed to check authentication status");
                return;
            }
            boolean isAuthenticated = authTask.getResult() != null
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
                    String msg = "Failed to get player info";
                    if (playerTask.getException() != null) msg += ": " + playerTask.getException().getMessage();
                    call.reject(msg);
                }
            });
    }

    // ── Achievements ─────────────────────────────────────────────────────────

    @PluginMethod
    public void unlockAchievement(PluginCall call) {
        String achievementId = call.getString("achievementId");
        if (achievementId == null || achievementId.isEmpty()) {
            call.reject("Missing achievementId");
            return;
        }
        PlayGames.getAchievementsClient(getActivity()).unlock(achievementId);
        call.resolve();
    }

    @PluginMethod
    public void incrementAchievement(PluginCall call) {
        String achievementId = call.getString("achievementId");
        Integer steps = call.getInt("steps", 1);
        if (achievementId == null || achievementId.isEmpty()) {
            call.reject("Missing achievementId");
            return;
        }
        PlayGames.getAchievementsClient(getActivity()).increment(achievementId, steps);
        call.resolve();
    }
}
