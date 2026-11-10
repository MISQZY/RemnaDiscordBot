package local.music.somafm;

import com.sedmelluq.discord.lavaplayer.player.AudioPlayerManager;
import dev.arbjerg.lavalink.api.AudioPlayerManagerConfiguration;
import org.springframework.stereotype.Service;

@Service
public class SomaPlugin implements AudioPlayerManagerConfiguration {
    @Override
    public AudioPlayerManager configure(AudioPlayerManager manager) {
        manager.registerSourceManager(new SomaSource());
        return manager;
    }
}
