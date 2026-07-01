/**
 * alsactl.c – Minimal ALSA sequencer ioctl helper.
 *
 * Usage:
 *   alsactl connect    <srcClient> <srcPort> <dstClient> <dstPort>
 *   alsactl disconnect <srcClient> <srcPort> <dstClient> <dstPort>
 *
 * Exit 0 on success, 1 on error (error message on stderr).
 * This helper is compiled once by the Node.js backend at startup.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <linux/types.h>

/* ── ALSA sequencer structs (from linux/sound/asequencer.h) ─────────────── */

struct snd_seq_addr {
    unsigned char client;
    unsigned char port;
};

struct snd_seq_port_subscribe {
    struct snd_seq_addr sender;
    struct snd_seq_addr dest;
    unsigned int        voices;
    unsigned int        flags;
    unsigned char       queue;
    unsigned char       pad[3];
    char                reserved[64];
};

/* ioctl numbers */
#define SNDRV_SEQ_IOCTL_SUBSCRIBE_PORT   _IOWR('S', 0x53, struct snd_seq_port_subscribe)
#define SNDRV_SEQ_IOCTL_UNSUBSCRIBE_PORT _IOWR('S', 0x54, struct snd_seq_port_subscribe)

/* ─────────────────────────────────────────────────────────────────────────── */

int main(int argc, char *argv[])
{
    if (argc != 6) {
        fprintf(stderr, "Usage: alsactl connect|disconnect <srcC> <srcP> <dstC> <dstP>\n");
        return 1;
    }

    const char *cmd     = argv[1];
    int src_client      = atoi(argv[2]);
    int src_port        = atoi(argv[3]);
    int dst_client      = atoi(argv[4]);
    int dst_port        = atoi(argv[5]);

    int is_connect = (strcmp(cmd, "connect") == 0);
    int is_disconnect = (strcmp(cmd, "disconnect") == 0);

    if (!is_connect && !is_disconnect) {
        fprintf(stderr, "Unknown command: %s\n", cmd);
        return 1;
    }

    int fd = open("/dev/snd/seq", O_RDWR);
    if (fd < 0) {
        perror("open /dev/snd/seq");
        return 1;
    }

    struct snd_seq_port_subscribe sub;
    memset(&sub, 0, sizeof(sub));
    sub.sender.client = (unsigned char)src_client;
    sub.sender.port   = (unsigned char)src_port;
    sub.dest.client   = (unsigned char)dst_client;
    sub.dest.port     = (unsigned char)dst_port;
    sub.queue         = 0;
    sub.flags         = 0;

    unsigned long req = is_connect
        ? SNDRV_SEQ_IOCTL_SUBSCRIBE_PORT
        : SNDRV_SEQ_IOCTL_UNSUBSCRIBE_PORT;

    int ret = ioctl(fd, req, &sub);
    close(fd);

    if (ret < 0) {
        perror(is_connect ? "SUBSCRIBE_PORT" : "UNSUBSCRIBE_PORT");
        return 1;
    }

    return 0;
}
