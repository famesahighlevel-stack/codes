import unittest
import re
from unified_ghl_app import extraer_datos_anuncio, extraer_secuencia

class TestFinalScript(unittest.TestCase):
    def test_extraer_datos_anuncio(self):
        text = "Anuncio A1234B567.Video promocional"
        anuncio, tipo = extraer_datos_anuncio(text)
        self.assertEqual(anuncio, "A1234B567")
        self.assertEqual(tipo, "Video promocional")

    def test_extraer_secuencia(self):
        text = "Campaña R2.1 Facebook"
        secuencia = extraer_secuencia(text)
        self.assertEqual(secuencia, "R2.1")

if __name__ == '__main__':
    unittest.main()
