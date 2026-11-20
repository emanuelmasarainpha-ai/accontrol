// =============================================================================
// Íconos y pantalla de arranque de la app de Android, a partir de los PNG de ACCONTROL (icons/).
// Uso (desde la carpeta del proyecto):  npm run android:iconos
//   (que ejecuta:  java tools/MakeAndroidIcons.java  con el Java de Android Studio)
// Sin librerías: solo Java (ImageIO). Reescribe SOLO los archivos de ícono y de arranque de android/app/src/main/res.
// =============================================================================
import java.awt.AlphaComposite;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.Ellipse2D;
import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

public class MakeAndroidIcons {
    static final Color BRAND = new Color(0x34, 0x20, 0x4f);
    static final String RES = "android/app/src/main/res/";
    static final String[] DENSITIES = {"mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"};
    static final double[] SCALE = {1, 1.5, 2, 3, 4};

    public static void main(String[] args) throws Exception {
        BufferedImage maskable = ImageIO.read(new File("icons/icon-maskable-512.png"));
        BufferedImage rounded = ImageIO.read(new File("icons/icon-512.png"));
        if (maskable == null || rounded == null) throw new IllegalStateException("Faltan icons/icon-maskable-512.png o icons/icon-512.png");

        for (int i = 0; i < DENSITIES.length; i++) {
            String dir = RES + "mipmap-" + DENSITIES[i] + "/";
            int legacy = (int) Math.round(48 * SCALE[i]);
            int layer = (int) Math.round(108 * SCALE[i]);
            write(resize(rounded, legacy), dir + "ic_launcher.png");
            write(circle(resize(maskable, legacy)), dir + "ic_launcher_round.png");
            // Capa delantera del ícono adaptable (108 dp; Android muestra el centro de 72 dp con la forma del teléfono).
            write(resize(maskable, layer), dir + "ic_launcher_foreground.png");
        }

        int[][] splash = {
            {480, 320, 0}, // drawable/splash.png
            {480, 800}, {320, 480}, {720, 1280}, {960, 1600}, {1280, 1920}, // port: hdpi, mdpi, xhdpi, xxhdpi, xxxhdpi
            {800, 480}, {480, 320}, {1280, 720}, {1600, 960}, {1920, 1280}, // land
        };
        String[] splashFiles = {
            "drawable/splash.png",
            "drawable-port-hdpi/splash.png", "drawable-port-mdpi/splash.png", "drawable-port-xhdpi/splash.png",
            "drawable-port-xxhdpi/splash.png", "drawable-port-xxxhdpi/splash.png",
            "drawable-land-hdpi/splash.png", "drawable-land-mdpi/splash.png", "drawable-land-xhdpi/splash.png",
            "drawable-land-xxhdpi/splash.png", "drawable-land-xxxhdpi/splash.png",
        };
        for (int i = 0; i < splash.length; i++) write(splash(maskable, splash[i][0], splash[i][1]), RES + splashFiles[i]);
        System.out.println("Íconos y pantallas de arranque de ACCONTROL listos.");
    }

    /** Reduce o amplía con buena calidad (por mitades al reducir mucho). */
    static BufferedImage resize(BufferedImage src, int size) {
        BufferedImage cur = src;
        int w = src.getWidth();
        while (w / 2 >= size) {
            w /= 2;
            cur = draw(cur, w, w);
        }
        return draw(cur, size, size);
    }

    static BufferedImage draw(BufferedImage src, int w, int h) {
        BufferedImage out = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = out.createGraphics();
        hints(g);
        g.drawImage(src, 0, 0, w, h, null);
        g.dispose();
        return out;
    }

    static BufferedImage circle(BufferedImage src) {
        int s = src.getWidth();
        BufferedImage out = new BufferedImage(s, s, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = out.createGraphics();
        hints(g);
        g.setColor(Color.WHITE);
        g.fill(new Ellipse2D.Double(0, 0, s, s));
        g.setComposite(AlphaComposite.SrcIn);
        g.drawImage(src, 0, 0, null);
        g.dispose();
        return out;
    }

    /** Fondo morado y la marca en el centro (la mitad del lado corto). */
    static BufferedImage splash(BufferedImage maskable, int w, int h) {
        BufferedImage out = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        hints(g);
        g.setColor(BRAND);
        g.fillRect(0, 0, w, h);
        int s = (int) Math.round(Math.min(w, h) * 0.75); // 3/4 del lado corto: el dibujo ya trae su propio margen morado
        BufferedImage icon = resize(maskable, s);
        g.drawImage(icon, (w - s) / 2, (h - s) / 2, null);
        g.dispose();
        return out;
    }

    static void hints(Graphics2D g) {
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
    }

    static void write(BufferedImage img, String path) throws Exception {
        File f = new File(path);
        if (!f.getParentFile().isDirectory()) throw new IllegalStateException("No existe la carpeta " + f.getParent());
        ImageIO.write(img, "png", f);
    }
}
